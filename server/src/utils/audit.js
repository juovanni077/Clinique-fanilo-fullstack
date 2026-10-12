const db = require("../db");
const { newId } = require("./mappers");

/**
 * Enregistre une entrée dans le journal d'audit. À utiliser pour toute
 * consultation ou modification de données médicales sensibles : qui a fait
 * quoi, sur le dossier de quel patient, et quand.
 *
 * @param {object} req  la requête Express en cours (pour l'utilisateur et l'IP)
 * @param {object} opts
 * @param {string} opts.action            ex: 'login_success', 'view_dossier', 'create_consultation'
 * @param {string} [opts.targetPatientId] id du patient concerné, si applicable
 * @param {string} [opts.resourceType]    ex: 'appointment', 'consultation'
 * @param {string} [opts.resourceId]
 * @param {string} [opts.detail]          courte précision lisible (jamais de données médicales en clair)
 * @param {object} [opts.actorOverride]   { id, role, nom } à utiliser à la place de req.user (ex: échec de connexion)
 */
function logAudit(req, opts) {
  try {
    const actor = opts.actorOverride || req.user || {};
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, user_nom, user_role, action, target_patient_id, resource_type, resource_id, detail, ip)
      VALUES (@id, @user_id, @user_nom, @user_role, @action, @target_patient_id, @resource_type, @resource_id, @detail, @ip)
    `).run({
      id: newId("log"),
      user_id: actor.id || null,
      user_nom: actor.nom || null,
      user_role: actor.role || null,
      action: opts.action,
      target_patient_id: opts.targetPatientId || null,
      resource_type: opts.resourceType || null,
      resource_id: opts.resourceId || null,
      detail: opts.detail || null,
      ip: req.ip || null,
    });
  } catch (e) {
    // Le journal d'audit ne doit jamais faire échouer la requête principale.
    console.error("Échec de journalisation d'audit :", e.message);
  }
}

module.exports = { logAudit };
