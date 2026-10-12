const express = require("express");
const db = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { newId, toPublicConsultation } = require("../utils/mappers");
const { validateConsultationPayload } = require("../utils/validate");
const { logAudit } = require("../utils/audit");

const router = express.Router();

/**
 * Le personnel soignant ne peut plus lister TOUTES les consultations de
 * TOUS les patients d'un coup (ce n'était d'ailleurs utilisé nulle part
 * dans l'interface). Pour consulter le dossier d'un patient précis, on
 * passe par GET /api/patients/:id/dossier, qui journalise l'accès.
 * Seul un patient peut lister ses propres consultations directement.
 */
router.get("/", authRequired, (req, res) => {
  if (req.user.role !== "patient") {
    return res.status(403).json({ error: "Utilisez /api/patients/:id/dossier pour consulter le dossier d'un patient." });
  }
  const rows = db.prepare("SELECT * FROM consultations WHERE patient_id = ? ORDER BY date DESC").all(req.user.id);
  res.json(rows.map(toPublicConsultation));
});

/** Recherche de consultations par mot-clé dans le diagnostic (personnel soignant). */
router.get("/search", authRequired, (req, res) => {
  if (!["admin", "medecin", "infirmiere"].includes(req.user.role)) {
    return res.status(403).json({ error: "Accès refusé." });
  }
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const rows = db.prepare("SELECT * FROM consultations WHERE diagnostic LIKE ? OR notes LIKE ? ORDER BY date DESC LIMIT 50")
    .all(`%${q}%`, `%${q}%`);
  logAudit(req, { action: "search_consultations", detail: `recherche: "${q}"` });
  res.json(rows.map(toPublicConsultation));
});

router.post("/", authRequired, requireRole("medecin"), (req, res) => {
  const b = req.body || {};
  const errors = validateConsultationPayload(b);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const patient = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'patient' AND deleted_at IS NULL").get(b.patientId);
  if (!patient) return res.status(400).json({ error: "Patient introuvable." });

  if (b.appointmentId) {
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(b.appointmentId);
    if (!appt || appt.medecin_id !== req.user.id) {
      return res.status(403).json({ error: "Ce rendez-vous ne vous appartient pas." });
    }
  }

  const id = newId("c");
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO consultations (id, patient_id, medecin_id, appointment_id, date, diagnostic, notes) VALUES (?,?,?,?,?,?,?)`)
    .run(id, b.patientId, req.user.id, b.appointmentId || null, date, b.diagnostic, b.notes || null);

  const created = db.prepare("SELECT * FROM consultations WHERE id = ?").get(id);
  logAudit(req, { action: "create_consultation", targetPatientId: b.patientId, resourceType: "consultation", resourceId: id });
  res.status(201).json(toPublicConsultation(created));
});

module.exports = router;
