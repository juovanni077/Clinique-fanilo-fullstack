const db = require("../db");
const { newId } = require("./mappers");

let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  const nodemailer = require("nodemailer");
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return mailer;
}

/** Enregistre une notification visible dans l'application. */
function createNotification({ userId, type, titre, message, appointmentId }) {
  const id = newId("n");
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, titre, message, appointment_id)
    VALUES (?,?,?,?,?,?)
  `).run(id, userId, type, titre, message, appointmentId || null);
  return id;
}

/**
 * Envoie un email réel si les variables SMTP_* sont configurées dans .env.
 * Sinon, ne fait rien silencieusement (la notification in-app suffit).
 */
async function sendEmailIfConfigured(to, subject, text) {
  const transport = getMailer();
  if (!transport || !to) return false;
  try {
    await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
    return true;
  } catch (e) {
    console.error("Échec d'envoi d'email :", e.message);
    return false;
  }
}

/**
 * Point d'intégration SMS — non actif par défaut.
 * Pour l'activer réellement : crée un compte chez un fournisseur (Twilio,
 * Vonage...), renseigne SMS_PROVIDER_SID / SMS_PROVIDER_TOKEN /
 * SMS_FROM_NUMBER dans .env, installe leur SDK (`npm install twilio` par
 * exemple), puis remplace le corps de cette fonction par un vrai appel API.
 */
async function sendSmsIfConfigured(toPhoneNumber, message) {
  if (!process.env.SMS_PROVIDER_SID || !toPhoneNumber) return false;
  console.log(`[SMS non envoyé — intégration à compléter] à ${toPhoneNumber} : ${message}`);
  return false;
}

/**
 * Notifie à la fois le patient et le médecin d'un rendez-vous, avec un
 * message adapté selon l'action. N'échoue jamais bruyamment : une panne
 * d'email/SMS ne doit pas empêcher l'action principale de réussir.
 */
async function notifyAppointmentEvent({ appointment, patient, medecin, action }) {
  const messages = {
    created: {
      patientTitre: "Rendez-vous demandé",
      patientMsg: `Votre demande de rendez-vous avec ${medecin.nom} le ${appointment.date} à ${appointment.heure} a été enregistrée.`,
      medecinTitre: "Nouveau rendez-vous",
      medecinMsg: `${patient.nom} a demandé un rendez-vous le ${appointment.date} à ${appointment.heure}.`,
    },
    confirmed: {
      patientTitre: "Rendez-vous confirmé",
      patientMsg: `Votre rendez-vous avec ${medecin.nom} le ${appointment.date} à ${appointment.heure} est confirmé.`,
      medecinTitre: "Rendez-vous confirmé",
      medecinMsg: `Le rendez-vous avec ${patient.nom} le ${appointment.date} à ${appointment.heure} est confirmé.`,
    },
    cancelled: {
      patientTitre: "Rendez-vous annulé",
      patientMsg: `Le rendez-vous avec ${medecin.nom} du ${appointment.date} à ${appointment.heure} a été annulé.`,
      medecinTitre: "Rendez-vous annulé",
      medecinMsg: `Le rendez-vous avec ${patient.nom} du ${appointment.date} à ${appointment.heure} a été annulé.`,
    },
    completed: {
      patientTitre: "Consultation terminée",
      patientMsg: `Votre consultation du ${appointment.date} avec ${medecin.nom} est terminée. Consultez votre dossier pour le détail.`,
      medecinTitre: null,
      medecinMsg: null,
    },
  };
  const m = messages[action];
  if (!m) return;

  createNotification({ userId: patient.id, type: `appointment_${action}`, titre: m.patientTitre, message: m.patientMsg, appointmentId: appointment.id });
  await sendEmailIfConfigured(patient.email, m.patientTitre, m.patientMsg);
  await sendSmsIfConfigured(patient.telephone, m.patientMsg);

  if (m.medecinTitre) {
    createNotification({ userId: medecin.id, type: `appointment_${action}`, titre: m.medecinTitre, message: m.medecinMsg, appointmentId: appointment.id });
    await sendEmailIfConfigured(medecin.email, m.medecinTitre, m.medecinMsg);
  }
}

/**
 * Prévient tous les administrateurs quand un médicament passe SOUS son
 * seuil d'alerte — uniquement au moment où il franchit ce seuil (pas à
 * chaque nouvelle décrémentation tant qu'il reste bas), pour ne pas
 * spammer de notifications répétées pour le même article.
 */
function notifyLowStockIfNeeded(db, medication, previousStock) {
  if (medication.stock > medication.seuil_alerte) return; // toujours au-dessus, rien à signaler
  if (previousStock !== null && previousStock <= medication.seuil_alerte) return; // déjà signalé avant

  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL").all();
  const titre = medication.stock <= 0 ? "Stock épuisé" : "Stock bas";
  const message = medication.stock <= 0
    ? `${medication.nom} n'a plus de stock à la pharmacie.`
    : `${medication.nom} passe sous le seuil d'alerte : il reste ${medication.stock} ${medication.unite}.`;
  admins.forEach((a) => {
    createNotification({ userId: a.id, type: "low_stock", titre, message });
  });
}

module.exports = { createNotification, sendEmailIfConfigured, sendSmsIfConfigured, notifyAppointmentEvent, notifyLowStockIfNeeded };
