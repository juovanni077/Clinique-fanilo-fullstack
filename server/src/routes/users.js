const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");

const ROLE_LABELS_FR = { admin: "administrateur", medecin: "médecin", infirmiere: "infirmière", patient: "patient" };
const { newId, toPublicUser } = require("../utils/mappers");
const { validateUserPayload, isValidPhoto } = require("../utils/validate");
const { logAudit } = require("../utils/audit");

const router = express.Router();

/**
 * GET /api/users            -> liste complète (comptes actifs), admin uniquement
 * GET /api/users?role=X     -> liste filtrée par rôle (comptes actifs)
 *   - role=medecin  : accessible à tous les comptes authentifiés
 *     (nécessaire pour la prise de rendez-vous et l'affichage des noms)
 *   - role=patient  : accessible à admin / medecin / infirmiere
 *   - role=infirmiere ou admin : admin uniquement
 *
 * IMPORTANT : la corbeille a sa propre route (GET /trash) — cette route-ci
 * ne renvoie jamais un compte supprimé.
 */
router.get("/", authRequired, (req, res) => {
  const { role } = req.query;
  const requester = req.user.role;

  if (!role) {
    if (requester !== "admin") {
      return res.status(403).json({ error: "Accès réservé à l'administrateur." });
    }
    const rows = db.prepare("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY nom").all();
    return res.json(rows.map(toPublicUser));
  }

  if (!["admin", "medecin", "infirmiere", "patient"].includes(role)) {
    return res.status(400).json({ error: "Rôle invalide." });
  }
  if (role === "patient" && !["admin", "medecin", "infirmiere"].includes(requester)) {
    return res.status(403).json({ error: "Accès refusé." });
  }
  if ((role === "infirmiere" || role === "admin") && requester !== "admin") {
    return res.status(403).json({ error: "Accès refusé." });
  }

  const rows = db.prepare("SELECT * FROM users WHERE role = ? AND deleted_at IS NULL ORDER BY nom").all(role);
  res.json(rows.map(toPublicUser));
});

/** Corbeille : comptes supprimés, réservée à l'administrateur. */
router.get("/trash", authRequired, requireRole("admin"), (req, res) => {
  const rows = db.prepare("SELECT * FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all();
  res.json(rows.map((r) => ({ ...toPublicUser(r), deletedAt: r.deleted_at })));
});

router.get("/:id", authRequired, (req, res) => {
  const requester = req.user;
  const row = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Introuvable." });

  const isSelf = requester.id === row.id;
  const isStaff = ["admin", "medecin", "infirmiere"].includes(requester.role);
  if (!isSelf && !isStaff) {
    return res.status(403).json({ error: "Accès refusé." });
  }
  res.json(toPublicUser(row));
});

/** Chacun peut changer sa propre photo, sans passer par l'admin. */
router.patch("/me/photo", authRequired, (req, res) => {
  const { photo } = req.body || {};
  if (!isValidPhoto(photo)) {
    return res.status(400).json({ error: "Photo invalide ou trop volumineuse (300 Ko maximum)." });
  }
  db.prepare("UPDATE users SET photo = ? WHERE id = ? AND deleted_at IS NULL").run(photo || null, req.user.id);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!updated) return res.status(404).json({ error: "Compte introuvable." });
  logAudit(req, { action: "update_user", resourceType: "user", resourceId: req.user.id, detail: "photo de profil" });
  res.json(toPublicUser(updated));
});

router.post("/", authRequired, requireRole("admin"), (req, res) => {
  const b = req.body || {};
  const errors = validateUserPayload(b, { requirePassword: true });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const email = String(b.email).toLowerCase().trim();
  const existing = db.prepare("SELECT id FROM users WHERE email = ? AND deleted_at IS NULL").get(email);
  if (existing) {
    return res.status(409).json({ error: "Cet email est déjà utilisé par un autre compte." });
  }
  const id = newId("u");
  const hash = bcrypt.hashSync(b.password, 10);
  db.prepare(`
    INSERT INTO users (id, role, nom, email, password_hash, telephone, specialite, service, date_naissance, sexe, groupe_sanguin, allergies, adresse, photo)
    VALUES (@id, @role, @nom, @email, @password_hash, @telephone, @specialite, @service, @date_naissance, @sexe, @groupe_sanguin, @allergies, @adresse, @photo)
  `).run({
    id, role: b.role, nom: b.nom, email, password_hash: hash,
    telephone: b.telephone || null, specialite: b.specialite || null, service: b.service || null,
    date_naissance: b.dateNaissance || null, sexe: b.sexe || null, groupe_sanguin: b.groupeSanguin || null,
    allergies: b.allergies || null, adresse: b.adresse || null, photo: b.photo || null,
  });
  const created = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  logAudit(req, { action: "create_user", resourceType: "user", resourceId: id, detail: `rôle : ${ROLE_LABELS_FR[b.role] || b.role}`, targetPatientId: b.role === "patient" ? id : null });
  res.status(201).json(toPublicUser(created));
});

router.put("/:id", authRequired, requireRole("admin"), (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable (ce compte est peut-être dans la corbeille)." });
  const b = req.body || {};
  const errors = validateUserPayload({ ...b, role: b.role || existing.role }, { requirePassword: false });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  if (b.email) {
    const email = String(b.email).toLowerCase().trim();
    const clash = db.prepare("SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL").get(email, req.params.id);
    if (clash) return res.status(409).json({ error: "Cet email est déjà utilisé par un autre compte." });
  }

  const hash = b.password ? bcrypt.hashSync(b.password, 10) : existing.password_hash;
  db.prepare(`
    UPDATE users SET
      nom = @nom, email = @email, password_hash = @password_hash, telephone = @telephone,
      specialite = @specialite, service = @service, date_naissance = @date_naissance,
      sexe = @sexe, groupe_sanguin = @groupe_sanguin, allergies = @allergies, adresse = @adresse,
      photo = @photo
    WHERE id = @id
  `).run({
    id: req.params.id,
    nom: b.nom ?? existing.nom,
    email: (b.email ? String(b.email).toLowerCase().trim() : existing.email),
    password_hash: hash,
    telephone: b.telephone ?? existing.telephone,
    specialite: b.specialite ?? existing.specialite,
    service: b.service ?? existing.service,
    date_naissance: b.dateNaissance ?? existing.date_naissance,
    sexe: b.sexe ?? existing.sexe,
    groupe_sanguin: b.groupeSanguin ?? existing.groupe_sanguin,
    allergies: b.allergies ?? existing.allergies,
    adresse: b.adresse ?? existing.adresse,
    photo: b.photo ?? existing.photo,
  });
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  logAudit(req, { action: "update_user", resourceType: "user", resourceId: req.params.id, targetPatientId: existing.role === "patient" ? existing.id : null });
  res.json(toPublicUser(updated));
});

/**
 * Suppression = déplacement vers la corbeille (deleted_at renseigné), pas
 * une suppression réelle. Ça évite de casser l'historique (rendez-vous,
 * consultations...) qui référence ce compte, et permet une récupération.
 */
router.delete("/:id", authRequired, requireRole("admin"), (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
  }
  const existing = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable." });

  db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit(req, { action: "delete_user", resourceType: "user", resourceId: req.params.id, detail: `rôle : ${ROLE_LABELS_FR[existing.role] || existing.role}` });
  res.status(204).end();
});

/** Restaure un compte depuis la corbeille. */
router.post("/:id/restore", authRequired, requireRole("admin"), (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NOT NULL").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Ce compte n'est pas dans la corbeille." });

  const clash = db.prepare("SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL").get(existing.email, existing.id);
  if (clash) {
    return res.status(409).json({ error: "Impossible de restaurer : un autre compte actif utilise déjà cet email." });
  }

  db.prepare("UPDATE users SET deleted_at = NULL WHERE id = ?").run(req.params.id);
  const restored = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  logAudit(req, { action: "restore_user", resourceType: "user", resourceId: req.params.id, detail: `rôle : ${ROLE_LABELS_FR[existing.role] || existing.role}`, targetPatientId: existing.role === "patient" ? existing.id : null });
  res.json(toPublicUser(restored));
});

/**
 * Suppression définitive et irréversible — uniquement pour un compte déjà
 * dans la corbeille (double confirmation : mettre à la corbeille d'abord,
 * purger ensuite). L'historique médical lié (rendez-vous, consultations...)
 * n'est pas supprimé, pour ne pas casser les dossiers d'autres patients.
 */
router.delete("/:id/permanent", authRequired, requireRole("admin"), (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NOT NULL").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Ce compte doit d'abord être dans la corbeille." });

  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  logAudit(req, { action: "purge_user", resourceType: "user", resourceId: req.params.id, detail: `rôle : ${ROLE_LABELS_FR[existing.role] || existing.role}` });
  res.status(204).end();
});

module.exports = router;
