const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "change-moi-avant-la-production";

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentification requise." });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload; // { id, role }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session invalide ou expirée, merci de vous reconnecter." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Vous n'avez pas les droits nécessaires pour cette action." });
    }
    next();
  };
}

module.exports = { authRequired, requireRole, SECRET };
