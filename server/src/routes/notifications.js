const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

function toPublic(row) {
  return {
    id: row.id, type: row.type, titre: row.titre, message: row.message,
    appointmentId: row.appointment_id, lu: !!row.lu, createdAt: row.created_at,
  };
}

router.get("/", authRequired, (req, res) => {
  const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(req.user.id);
  res.json(rows.map(toPublic));
});

router.patch("/:id/read", authRequired, (req, res) => {
  const n = db.prepare("SELECT * FROM notifications WHERE id = ?").get(req.params.id);
  if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: "Introuvable." });
  db.prepare("UPDATE notifications SET lu = 1 WHERE id = ?").run(req.params.id);
  res.json(toPublic(db.prepare("SELECT * FROM notifications WHERE id = ?").get(req.params.id)));
});

router.post("/read-all", authRequired, (req, res) => {
  db.prepare("UPDATE notifications SET lu = 1 WHERE user_id = ?").run(req.user.id);
  res.status(204).end();
});

module.exports = router;
