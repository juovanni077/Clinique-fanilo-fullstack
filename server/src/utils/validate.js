// Validation manuelle, volontairement sans dépendance externe. Chaque
// fonction renvoie soit null (valeur valide), soit un message d'erreur en
// français prêt à être renvoyé au client.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROLES = ["admin", "medecin", "infirmiere", "patient"];
const STATUTS = ["planifié", "confirmé", "terminé", "annulé"];

function isNonEmptyString(v, max = 255) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}
function isValidEmail(v) {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v.trim());
}
function isValidDate(v) {
  return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(new Date(v).getTime());
}
function isValidTime(v) {
  return typeof v === "string" && TIME_RE.test(v);
}
function isOneOf(v, list) {
  return list.includes(v);
}

/** Valide le corps d'une création/modification de compte utilisateur. */
function validateUserPayload(b, { requirePassword }) {
  const errors = [];
  if (!isOneOf(b.role, ROLES)) errors.push("Le rôle est invalide.");
  if (!isNonEmptyString(b.nom, 120)) errors.push("Le nom est requis (120 caractères maximum).");
  if (!isValidEmail(b.email)) errors.push("L'adresse email est invalide.");
  if (!isValidPhoto(b.photo)) errors.push("La photo est invalide ou trop volumineuse (300 Ko maximum).");
  if (requirePassword && (!isNonEmptyString(b.password, 200) || b.password.length < 6)) {
    errors.push("Le mot de passe doit contenir au moins 6 caractères.");
  }
  if (b.password && !requirePassword && b.password.length > 0 && b.password.length < 6) {
    errors.push("Le mot de passe doit contenir au moins 6 caractères.");
  }
  if (b.telephone && !isNonEmptyString(b.telephone, 30)) errors.push("Le téléphone est invalide.");
  if (b.role === "medecin" && b.specialite && !isNonEmptyString(b.specialite, 80)) errors.push("La spécialité est invalide.");
  if (b.role === "infirmiere" && b.service && !isNonEmptyString(b.service, 80)) errors.push("Le service est invalide.");
  if (b.role === "patient") {
    if (b.dateNaissance && !isValidDate(b.dateNaissance)) errors.push("La date de naissance est invalide (format AAAA-MM-JJ).");
    if (b.sexe && !isOneOf(b.sexe, ["F", "M"])) errors.push("Le sexe doit être F ou M.");
    if (b.groupeSanguin && !isNonEmptyString(b.groupeSanguin, 10)) errors.push("Le groupe sanguin est invalide.");
    if (b.allergies && !isNonEmptyString(b.allergies, 500)) errors.push("Le champ allergies est trop long.");
    if (b.adresse && !isNonEmptyString(b.adresse, 300)) errors.push("L'adresse est trop longue.");
  }
  return errors;
}

function validateAppointmentPayload(b) {
  const errors = [];
  if (!isNonEmptyString(b.medecinId, 100)) errors.push("Le médecin est requis.");
  if (!isValidDate(b.date)) errors.push("La date est invalide (format AAAA-MM-JJ).");
  if (!isValidTime(b.heure)) errors.push("L'heure est invalide (format HH:MM).");
  if (!isNonEmptyString(b.motif, 500)) errors.push("Le motif est requis (500 caractères maximum).");
  return errors;
}

function validateStatutPayload(b) {
  const errors = [];
  if (!isOneOf(b.statut, STATUTS)) errors.push("Le statut est invalide.");
  return errors;
}

function validateConsultationPayload(b) {
  const errors = [];
  if (!isNonEmptyString(b.patientId, 100)) errors.push("Le patient est requis.");
  if (!isNonEmptyString(b.diagnostic, 500)) errors.push("Le diagnostic est requis (500 caractères maximum).");
  if (b.notes && !isNonEmptyString(b.notes, 4000)) errors.push("Les notes sont trop longues.");
  return errors;
}

function validatePrescriptionPayload(b) {
  const errors = [];
  if (!isNonEmptyString(b.patientId, 100)) errors.push("Le patient est requis.");
  if (!Array.isArray(b.medicaments) || b.medicaments.length === 0) {
    errors.push("Au moins un médicament est requis.");
  } else {
    for (const m of b.medicaments) {
      if (!m || !isNonEmptyString(m.nom, 150)) { errors.push("Le nom d'un médicament est invalide."); break; }
      if (m.dosage && !isNonEmptyString(m.dosage, 60)) { errors.push("Le dosage d'un médicament est invalide."); break; }
      if (m.frequence && !isNonEmptyString(m.frequence, 60)) { errors.push("La fréquence d'un médicament est invalide."); break; }
      if (m.duree && !isNonEmptyString(m.duree, 60)) { errors.push("La durée d'un médicament est invalide."); break; }
    }
  }
  if (b.instructions && !isNonEmptyString(b.instructions, 1000)) errors.push("Les instructions sont trop longues.");
  return errors;
}

function validateVitalsPayload(b) {
  const errors = [];
  if (!isNonEmptyString(b.patientId, 100)) errors.push("Le patient est requis.");
  if (!isNonEmptyString(b.tension, 20)) errors.push("La tension est requise.");
  if (!isNonEmptyString(b.pouls, 10)) errors.push("Le pouls est requis.");
  if (b.temperature && !isNonEmptyString(b.temperature, 10)) errors.push("La température est invalide.");
  if (b.poids && !isNonEmptyString(b.poids, 10)) errors.push("Le poids est invalide.");
  if (b.notes && !isNonEmptyString(b.notes, 1000)) errors.push("Les notes sont trop longues.");
  return errors;
}

function isValidPhoto(v) {
  if (v === null || v === undefined || v === "") return true; // pas de photo = valide
  return typeof v === "string" && v.startsWith("data:image/") && v.length <= 400000;
}

module.exports = {
  isValidEmail, isValidDate, isValidTime, isNonEmptyString, isOneOf, isValidPhoto,
  validateUserPayload, validateAppointmentPayload, validateStatutPayload,
  validateConsultationPayload, validatePrescriptionPayload, validateVitalsPayload,
};
