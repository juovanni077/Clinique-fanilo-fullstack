const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const { toPublicUser, toPublicConsultation, toPublicPrescription, toPublicVitals } = require("../utils/mappers");
const { logAudit } = require("../utils/audit");

const router = express.Router();

/**
 * Point d'accès unique et audité au dossier complet d'un patient
 * (profil + consultations + ordonnances + constantes). C'est la seule
 * façon, pour le personnel soignant, de consulter le dossier d'un patient
 * précis — chaque appel est journalisé avec qui a consulté quoi et quand.
 */
router.get("/:id/dossier", authRequired, (req, res) => {
  const { role, id: requesterId } = req.user;
  const patientId = req.params.id;

  const isSelf = role === "patient" && requesterId === patientId;
  const isStaff = ["admin", "medecin", "infirmiere"].includes(role);
  if (!isSelf && !isStaff) {
    return res.status(403).json({ error: "Accès refusé." });
  }

  const patientRow = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'patient' AND deleted_at IS NULL").get(patientId);
  if (!patientRow) return res.status(404).json({ error: "Patient introuvable." });

  const consultations = db.prepare("SELECT * FROM consultations WHERE patient_id = ? ORDER BY date DESC").all(patientId);
  const prescriptions = db.prepare("SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY date DESC").all(patientId);
  const vitals = db.prepare("SELECT * FROM vitals WHERE patient_id = ? ORDER BY date DESC").all(patientId);

  logAudit(req, {
    action: "view_dossier",
    targetPatientId: patientId,
    resourceType: "patient_dossier",
    resourceId: patientId,
  });

  res.json({
    patient: toPublicUser(patientRow),
    consultations: consultations.map(toPublicConsultation),
    prescriptions: prescriptions.map(toPublicPrescription),
    vitals: vitals.map(toPublicVitals),
  });
});

/**
 * Recherche avancée de patients par nom, email ou groupe sanguin — réservée
 * au personnel soignant (un patient ne peut pas chercher d'autres patients).
 */
router.get("/search", authRequired, (req, res) => {
  if (!["admin", "medecin", "infirmiere"].includes(req.user.role)) {
    return res.status(403).json({ error: "Accès refusé." });
  }
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const rows = db.prepare(`
    SELECT * FROM users
    WHERE role = 'patient' AND deleted_at IS NULL AND (nom LIKE ? OR email LIKE ? OR groupe_sanguin LIKE ?)
    ORDER BY nom LIMIT 30
  `).all(`%${q}%`, `%${q}%`, `%${q}%`);
  res.json(rows.map(toPublicUser));
});

module.exports = router;
