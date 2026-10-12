const express = require("express");
const db = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { newId } = require("../utils/mappers");
const { isNonEmptyString } = require("../utils/validate");
const { logAudit } = require("../utils/audit");
const { notifyLowStockIfNeeded } = require("../utils/notify");

const router = express.Router();

function toPublic(row) {
  return {
    id: row.id, nom: row.nom, unite: row.unite, stock: row.stock,
    seuilAlerte: row.seuil_alerte, createdAt: row.created_at,
  };
}

// Consultable par tout le personnel soignant (utile au médecin pour savoir
// si un médicament est disponible avant de le prescrire).
router.get("/", authRequired, (req, res) => {
  if (!["admin", "medecin", "infirmiere"].includes(req.user.role)) {
    return res.status(403).json({ error: "Accès refusé." });
  }
  const rows = db.prepare("SELECT * FROM medications ORDER BY nom").all();
  res.json(rows.map(toPublic));
});

// Gestion du stock réservée à l'administration (on pourrait introduire un
// rôle "pharmacien" dédié plus tard si le volume le justifie).
router.post("/", authRequired, requireRole("admin"), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.nom, 150)) return res.status(400).json({ error: "Le nom est requis." });
  const stock = Number.isFinite(b.stock) ? Math.max(0, Math.round(b.stock)) : 0;
  const seuil = Number.isFinite(b.seuilAlerte) ? Math.max(0, Math.round(b.seuilAlerte)) : 10;

  const existing = db.prepare("SELECT id FROM medications WHERE LOWER(nom) = LOWER(?)").get(b.nom.trim());
  if (existing) return res.status(409).json({ error: "Ce médicament existe déjà dans le stock." });

  const id = newId("m");
  db.prepare("INSERT INTO medications (id, nom, unite, stock, seuil_alerte) VALUES (?,?,?,?,?)")
    .run(id, b.nom.trim(), b.unite && isNonEmptyString(b.unite, 30) ? b.unite : "unité", stock, seuil);

  const created = db.prepare("SELECT * FROM medications WHERE id = ?").get(id);
  logAudit(req, { action: "create_medication", resourceType: "medication", resourceId: id, detail: b.nom });
  res.status(201).json(toPublic(created));
});

router.put("/:id", authRequired, requireRole("admin"), (req, res) => {
  const existing = db.prepare("SELECT * FROM medications WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable." });
  const b = req.body || {};
  const stock = Number.isFinite(b.stock) ? Math.max(0, Math.round(b.stock)) : existing.stock;
  const seuil = Number.isFinite(b.seuilAlerte) ? Math.max(0, Math.round(b.seuilAlerte)) : existing.seuil_alerte;

  db.prepare("UPDATE medications SET nom = ?, unite = ?, stock = ?, seuil_alerte = ? WHERE id = ?")
    .run(b.nom ?? existing.nom, b.unite ?? existing.unite, stock, seuil, req.params.id);

  const updated = db.prepare("SELECT * FROM medications WHERE id = ?").get(req.params.id);
  logAudit(req, { action: "update_medication", resourceType: "medication", resourceId: req.params.id, detail: `nouveau stock : ${updated.stock}` });
  notifyLowStockIfNeeded(db, updated, existing.stock);
  res.json(toPublic(updated));
});

router.delete("/:id", authRequired, requireRole("admin"), (req, res) => {
  const result = db.prepare("DELETE FROM medications WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Introuvable." });
  res.status(204).end();
});

module.exports = router;
