const express = require("express");
const db = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { newId, toPublicVitals } = require("../utils/mappers");
const { validateVitalsPayload } = require("../utils/validate");
const { logAudit } = require("../utils/audit");

const router = express.Router();

/**
 * Un patient voit ses propres mesures. Une infirmière voit les mesures
 * qu'elle a elle-même prises (utile pour son propre historique de suivi).
 * Pour voir TOUTES les mesures d'un patient précis (prises par n'importe
 * quel soignant), le personnel passe par /api/patients/:id/dossier.
 */
router.get("/", authRequired, (req, res) => {
  const { role, id } = req.user;
  let rows;
  if (role === "patient") {
    rows = db.prepare("SELECT * FROM vitals WHERE patient_id = ? ORDER BY date DESC").all(id);
  } else if (role === "infirmiere") {
    rows = db.prepare("SELECT * FROM vitals WHERE infirmiere_id = ? ORDER BY date DESC").all(id);
  } else {
    return res.status(403).json({ error: "Utilisez /api/patients/:id/dossier pour consulter les constantes d'un patient." });
  }
  res.json(rows.map(toPublicVitals));
});

router.post("/", authRequired, requireRole("infirmiere"), (req, res) => {
  const b = req.body || {};
  const errors = validateVitalsPayload(b);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const patient = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'patient' AND deleted_at IS NULL").get(b.patientId);
  if (!patient) return res.status(400).json({ error: "Patient introuvable." });

  const id = newId("v");
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO vitals (id, patient_id, infirmiere_id, date, tension, temperature, pouls, poids, notes) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, b.patientId, req.user.id, date, b.tension, b.temperature || null, b.pouls, b.poids || null, b.notes || null);

  const created = db.prepare("SELECT * FROM vitals WHERE id = ?").get(id);
  logAudit(req, { action: "create_vitals", targetPatientId: b.patientId, resourceType: "vitals", resourceId: id });
  res.status(201).json(toPublicVitals(created));
});

module.exports = router;
