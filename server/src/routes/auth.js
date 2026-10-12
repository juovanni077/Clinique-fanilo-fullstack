const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { SECRET, authRequired } = require("../middleware/auth");
const { toPublicUser } = require("../utils/mappers");
const { logAudit } = require("../utils/audit");
const { isValidEmail } = require("../utils/validate");

const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !isValidEmail(email) || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis." });
  }
  const normalizedEmail = String(email).toLowerCase().trim();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);

  if (!user || user.deleted_at || !bcrypt.compareSync(password, user.password_hash)) {
    logAudit(req, {
      action: "login_failed",
      detail: `tentative avec l'email ${normalizedEmail}`,
      actorOverride: { id: null, role: null, nom: null },
    });
    return res.status(401).json({ error: "Email ou mot de passe incorrect." });
  }

  const token = jwt.sign({ id: user.id, role: user.role, nom: user.nom }, SECRET, { expiresIn: "12h" });
  logAudit(req, {
    action: "login_success",
    actorOverride: { id: user.id, role: user.role, nom: user.nom },
  });
  res.json({ token, user: toPublicUser(user) });
});

router.get("/me", authRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(req.user.id);
  if (!user) return res.status(404).json({ error: "Compte introuvable ou désactivé." });
  res.json(toPublicUser(user));
});

module.exports = router;
