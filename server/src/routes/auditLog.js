const express = require("express");
const db = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");

const router = express.Router();

function toPublic(row) {
  return {
    id: row.id, userId: row.user_id, userNom: row.user_nom, userRole: row.user_role,
    action: row.action, targetPatientId: row.target_patient_id, resourceType: row.resource_type,
    resourceId: row.resource_id, detail: row.detail, ip: row.ip, createdAt: row.created_at,
  };
}

/**
 * Journal d'audit — réservé à l'administrateur. Filtrable par patient
 * concerné (pour répondre à "qui a consulté le dossier de ce patient ?")
 * et paginé simplement avec une limite.
 */
router.get("/", authRequired, requireRole("admin"), (req, res) => {
  const { patientId, action, limit } = req.query;
  const cap = Math.min(Number(limit) || 100, 500);

  let query = "SELECT * FROM audit_logs WHERE 1=1";
  const params = [];
  if (patientId) { query += " AND target_patient_id = ?"; params.push(patientId); }
  if (action) { query += " AND action = ?"; params.push(action); }
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(cap);

  const rows = db.prepare(query).all(...params);
  res.json(rows.map(toPublic));
});

module.exports = router;
