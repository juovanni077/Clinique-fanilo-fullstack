const express = require("express");
const db = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { newId } = require("../utils/mappers");
const { logAudit } = require("../utils/audit");

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toPublicSlot(r) {
  return { id: r.id, medecinId: r.medecin_id, jourSemaine: r.jour_semaine, heureDebut: r.heure_debut, heureFin: r.heure_fin };
}
function toPublicAbsence(r) {
  return { id: r.id, medecinId: r.medecin_id, date: r.date, motif: r.motif };
}

function canManage(req, medecinId) {
  return req.user.role === "admin" || (req.user.role === "medecin" && req.user.id === medecinId);
}

/**
 * GET /api/availability/:medecinId
 * Accessible à tout compte authentifié (nécessaire pour proposer des
 * créneaux au patient au moment de la prise de rendez-vous).
 */
router.get("/:medecinId", authRequired, (req, res) => {
  const medecin = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'medecin' AND deleted_at IS NULL").get(req.params.medecinId);
  if (!medecin) return res.status(404).json({ error: "Médecin introuvable." });

  const slots = db.prepare("SELECT * FROM availability WHERE medecin_id = ? ORDER BY jour_semaine, heure_debut").all(req.params.medecinId);
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const absences = db.prepare("SELECT * FROM absences WHERE medecin_id = ? AND date >= ? ORDER BY date").all(req.params.medecinId, from);

  res.json({ slots: slots.map(toPublicSlot), absences: absences.map(toPublicAbsence) });
});

router.post("/:medecinId/slots", authRequired, (req, res) => {
  if (!canManage(req, req.params.medecinId)) return res.status(403).json({ error: "Accès refusé." });
  const b = req.body || {};
  const jour = Number(b.jourSemaine);
  if (!Number.isInteger(jour) || jour < 0 || jour > 6) return res.status(400).json({ error: "Jour de la semaine invalide." });
  if (!TIME_RE.test(b.heureDebut) || !TIME_RE.test(b.heureFin)) return res.status(400).json({ error: "Heures invalides (format HH:MM)." });
  if (b.heureDebut >= b.heureFin) return res.status(400).json({ error: "L'heure de fin doit être après l'heure de début." });

  const id = newId("av");
  db.prepare("INSERT INTO availability (id, medecin_id, jour_semaine, heure_debut, heure_fin) VALUES (?,?,?,?,?)")
    .run(id, req.params.medecinId, jour, b.heureDebut, b.heureFin);
  const created = db.prepare("SELECT * FROM availability WHERE id = ?").get(id);
  logAudit(req, { action: "create_availability", resourceType: "availability", resourceId: id });
  res.status(201).json(toPublicSlot(created));
});

router.delete("/slots/:id", authRequired, (req, res) => {
  const slot = db.prepare("SELECT * FROM availability WHERE id = ?").get(req.params.id);
  if (!slot) return res.status(404).json({ error: "Introuvable." });
  if (!canManage(req, slot.medecin_id)) return res.status(403).json({ error: "Accès refusé." });
  db.prepare("DELETE FROM availability WHERE id = ?").run(req.params.id);
  logAudit(req, { action: "delete_availability", resourceType: "availability", resourceId: req.params.id });
  res.status(204).end();
});

router.post("/:medecinId/absences", authRequired, (req, res) => {
  if (!canManage(req, req.params.medecinId)) return res.status(403).json({ error: "Accès refusé." });
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: "Date invalide (format AAAA-MM-JJ)." });

  const id = newId("abs");
  db.prepare("INSERT INTO absences (id, medecin_id, date, motif) VALUES (?,?,?,?)")
    .run(id, req.params.medecinId, b.date, b.motif || null);
  const created = db.prepare("SELECT * FROM absences WHERE id = ?").get(id);
  logAudit(req, { action: "create_absence", resourceType: "absence", resourceId: id });
  res.status(201).json(toPublicAbsence(created));
});

router.delete("/absences/:id", authRequired, (req, res) => {
  const absence = db.prepare("SELECT * FROM absences WHERE id = ?").get(req.params.id);
  if (!absence) return res.status(404).json({ error: "Introuvable." });
  if (!canManage(req, absence.medecin_id)) return res.status(403).json({ error: "Accès refusé." });
  db.prepare("DELETE FROM absences WHERE id = ?").run(req.params.id);
  logAudit(req, { action: "delete_absence", resourceType: "absence", resourceId: req.params.id });
  res.status(204).end();
});

/**
 * GET /api/availability/:medecinId/slots?date=AAAA-MM-JJ
 * Calcule les créneaux de 30 minutes réellement disponibles ce jour-là
 * (horaires du médecin, moins les rendez-vous déjà pris, moins les
 * absences) — sans exposer les rendez-vous des autres patients, juste
 * la liste des heures libres.
 */
router.get("/:medecinId/slots", authRequired, (req, res) => {
  const medecinId = req.params.medecinId;
  const date = req.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return res.status(400).json({ error: "Date invalide." });

  // L'absence est vérifiée AVANT tout, indépendamment du fait que le
  // médecin ait ou non des horaires récurrents configurés — sinon un
  // médecin sans horaires configurés restait proposable pendant ses
  // absences (le formulaire retombait sur une saisie libre de l'heure).
  const absence = db.prepare("SELECT id FROM absences WHERE medecin_id = ? AND date = ?").get(medecinId, date);
  if (absence) return res.json({ configured: true, slots: [], absent: true });

  const windows = db.prepare("SELECT * FROM availability WHERE medecin_id = ? AND jour_semaine = ?")
    .all(medecinId, new Date(date + "T00:00:00").getDay());

  if (windows.length === 0) {
    // Ce médecin n'a pas configuré d'horaires ce jour de la semaine : on ne
    // peut pas proposer de créneaux, le formulaire retombera sur une saisie
    // libre de l'heure (mais l'absence ci-dessus reste bloquante).
    return res.json({ configured: false, slots: [] });
  }

  const taken = new Set(
    db.prepare("SELECT heure FROM appointments WHERE medecin_id = ? AND date = ? AND statut != 'annulé'").all(medecinId, date).map((r) => r.heure)
  );

  const slots = [];
  for (const w of windows) {
    let [h, m] = w.heure_debut.split(":").map(Number);
    const [endH, endM] = w.heure_fin.split(":").map(Number);
    while (h < endH || (h === endH && m < endM)) {
      const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      if (!taken.has(t)) slots.push(t);
      m += 30;
      if (m >= 60) { m -= 60; h += 1; }
    }
  }
  res.json({ configured: true, slots, absent: false });
});

module.exports = router;
