const crypto = require("crypto");

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Convertit une ligne "users" (snake_case, avec le hash) en objet public
// sûr à renvoyer au client : jamais le password_hash.
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    nom: row.nom,
    email: row.email,
    telephone: row.telephone,
    specialite: row.specialite,
    service: row.service,
    dateNaissance: row.date_naissance,
    sexe: row.sexe,
    groupeSanguin: row.groupe_sanguin,
    allergies: row.allergies,
    adresse: row.adresse,
    photo: row.photo || null,
  };
}

function toPublicAppointment(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    medecinId: row.medecin_id,
    date: row.date,
    heure: row.heure,
    motif: row.motif,
    statut: row.statut,
  };
}

function toPublicConsultation(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    medecinId: row.medecin_id,
    appointmentId: row.appointment_id,
    date: row.date,
    diagnostic: row.diagnostic,
    notes: row.notes,
  };
}

function toPublicPrescription(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    medecinId: row.medecin_id,
    consultationId: row.consultation_id,
    date: row.date,
    medicaments: JSON.parse(row.medicaments),
    instructions: row.instructions,
  };
}

function toPublicVitals(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    infirmiereId: row.infirmiere_id,
    date: row.date,
    tension: row.tension,
    temperature: row.temperature,
    pouls: row.pouls,
    poids: row.poids,
    notes: row.notes,
  };
}

module.exports = {
  newId,
  toPublicUser,
  toPublicAppointment,
  toPublicConsultation,
  toPublicPrescription,
  toPublicVitals,
};
