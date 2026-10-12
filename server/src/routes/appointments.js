const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const { newId, toPublicAppointment, toPublicUser } = require("../utils/mappers");
const { validateAppointmentPayload, validateStatutPayload } = require("../utils/validate");
const { logAudit } = require("../utils/audit");
const { notifyAppointmentEvent } = require("../utils/notify");

const router = express.Router();

router.get("/", authRequired, (req, res) => {
  const { role, id } = req.user;
  let rows;
  if (role === "admin" || role === "infirmiere") {
    rows = db.prepare("SELECT * FROM appointments ORDER BY date, heure").all();
  } else if (role === "medecin") {
    rows = db.prepare("SELECT * FROM appointments WHERE medecin_id = ? ORDER BY date, heure").all(id);
  } else {
    rows = db.prepare("SELECT * FROM appointments WHERE patient_id = ? ORDER BY date, heure").all(id);
  }
  res.json(rows.map(toPublicAppointment));
});

router.post("/", authRequired, async (req, res) => {
  const b = req.body || {};
  const { role, id: requesterId } = req.user;

  const errors = validateAppointmentPayload(b);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  let patientId;
  if (role === "patient") {
    patientId = requesterId;
  } else if (role === "admin" || role === "infirmiere") {
    if (!b.patientId) return res.status(400).json({ error: "patientId requis." });
    patientId = b.patientId;
  } else {
    return res.status(403).json({ error: "Ce rôle ne peut pas créer de rendez-vous." });
  }

  const medecin = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'medecin' AND deleted_at IS NULL").get(b.medecinId);
  if (!medecin) return res.status(400).json({ error: "Médecin introuvable." });
  const patient = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'patient' AND deleted_at IS NULL").get(patientId);
  if (!patient) return res.status(400).json({ error: "Patient introuvable." });

  // Respecte les disponibilités du médecin, si elles ont été configurées
  // (un médecin qui n'a pas encore renseigné ses horaires n'est pas bloqué
  // pour autant — on ne restreint que si des créneaux existent réellement).
  const hasAvailability = db.prepare("SELECT COUNT(*) c FROM availability WHERE medecin_id = ?").get(b.medecinId).c > 0;
  if (hasAvailability) {
    const jourSemaine = new Date(b.date + "T00:00:00").getDay();
    const slot = db.prepare(`
      SELECT id FROM availability WHERE medecin_id = ? AND jour_semaine = ? AND heure_debut <= ? AND heure_fin > ?
    `).get(b.medecinId, jourSemaine, b.heure, b.heure);
    if (!slot) {
      return res.status(409).json({ error: `${medecin.nom} n'est pas disponible à ce créneau. Vérifie ses horaires habituels avant de choisir une date.` });
    }
  }

  // Les absences ponctuelles doivent bloquer la prise de rendez-vous que le
  // médecin ait ou non configuré des horaires récurrents — sinon un médecin
  // qui n'a pas encore renseigné ses horaires reste réservable pendant ses
  // absences déclarées.
  const absence = db.prepare("SELECT id FROM absences WHERE medecin_id = ? AND date = ?").get(b.medecinId, b.date);
  if (absence) {
    return res.status(409).json({ error: `${medecin.nom} est absent(e) ce jour-là. Merci de choisir une autre date.` });
  }

  // Détection de conflit d'horaire : un même médecin ne peut pas avoir deux
  // rendez-vous actifs (non annulés) au même créneau exact.
  const conflict = db.prepare(`
    SELECT id FROM appointments
    WHERE medecin_id = ? AND date = ? AND heure = ? AND statut != 'annulé'
  `).get(b.medecinId, b.date, b.heure);
  if (conflict) {
    return res.status(409).json({ error: `${medecin.nom} a déjà un rendez-vous à ce créneau (${b.date} à ${b.heure}). Merci de choisir un autre horaire.` });
  }

  const id = newId("a");
  db.prepare(`INSERT INTO appointments (id, patient_id, medecin_id, date, heure, motif, statut) VALUES (?,?,?,?,?,?,'planifié')`)
    .run(id, patientId, b.medecinId, b.date, b.heure, b.motif);

  const created = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
  logAudit(req, { action: "create_appointment", targetPatientId: patientId, resourceType: "appointment", resourceId: id });
  await notifyAppointmentEvent({ appointment: toPublicAppointment(created), patient: toPublicUser(patient), medecin: toPublicUser(medecin), action: "created" });

  res.status(201).json(toPublicAppointment(created));
});

router.patch("/:id/status", authRequired, async (req, res) => {
  const errors = validateStatutPayload(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const { statut } = req.body;

  const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.id);
  if (!appt) return res.status(404).json({ error: "Rendez-vous introuvable." });

  const { role, id: requesterId } = req.user;
  const isOwnerMedecin = role === "medecin" && appt.medecin_id === requesterId;
  const isOwnerPatient = role === "patient" && appt.patient_id === requesterId;
  const isStaff = role === "admin" || role === "infirmiere";

  if (!isOwnerMedecin && !isOwnerPatient && !isStaff) {
    return res.status(403).json({ error: "Vous ne pouvez pas modifier ce rendez-vous." });
  }
  if (role === "patient" && statut !== "annulé") {
    return res.status(403).json({ error: "Un patient peut uniquement annuler un rendez-vous." });
  }

  // Si on confirme (et non on annule/termine), on revérifie qu'aucun autre
  // rendez-vous actif du même médecin n'occupe déjà ce créneau entre-temps.
  if (statut === "confirmé") {
    const conflict = db.prepare(`
      SELECT id FROM appointments
      WHERE medecin_id = ? AND date = ? AND heure = ? AND statut != 'annulé' AND id != ?
    `).get(appt.medecin_id, appt.date, appt.heure, appt.id);
    if (conflict) {
      return res.status(409).json({ error: "Un autre rendez-vous occupe déjà ce créneau pour ce médecin." });
    }
  }

  db.prepare("UPDATE appointments SET statut = ? WHERE id = ?").run(statut, req.params.id);
  const updated = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.id);
  logAudit(req, { action: "update_appointment_status", targetPatientId: appt.patient_id, resourceType: "appointment", resourceId: appt.id, detail: `nouveau statut : ${statut}` });

  const patient = db.prepare("SELECT * FROM users WHERE id = ?").get(appt.patient_id);
  const medecin = db.prepare("SELECT * FROM users WHERE id = ?").get(appt.medecin_id);
  const actionMap = { "confirmé": "confirmed", "annulé": "cancelled", "terminé": "completed" };
  if (actionMap[statut]) {
    await notifyAppointmentEvent({ appointment: toPublicAppointment(updated), patient: toPublicUser(patient), medecin: toPublicUser(medecin), action: actionMap[statut] });
  }

  res.json(toPublicAppointment(updated));
});

module.exports = router;
