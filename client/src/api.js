// Petit client HTTP pour l'API Clinique Fanilo. Gère le jeton de
// connexion (JWT) et centralise tous les appels réseau.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const TOKEN_STORAGE_KEY = "fanilo_token";

let authToken = null;

function setToken(token) {
  authToken = token;
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}
function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (e) {
    throw new Error("Impossible de joindre le serveur. Vérifie qu'il est bien lancé (npm run dev côté server).");
  }

  if (res.status === 204) return null;

  let data = null;
  try { data = await res.json(); } catch (e) { /* réponse vide */ }

  if (!res.ok) {
    throw new Error((data && data.error) || `Erreur serveur (${res.status})`);
  }
  return data;
}

export const api = {
  setToken,
  getStoredToken,

  login: (email, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request("/auth/me"),

  listUsers: (role) => request(`/users${role ? `?role=${encodeURIComponent(role)}` : ""}`),
  createUser: (payload) => request("/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (id, payload) => request(`/users/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteUser: (id) => request(`/users/${id}`, { method: "DELETE" }),
  listTrash: () => request("/users/trash"),
  restoreUser: (id) => request(`/users/${id}/restore`, { method: "POST" }),
  purgeUser: (id) => request(`/users/${id}/permanent`, { method: "DELETE" }),

  listAppointments: () => request("/appointments"),
  createAppointment: (payload) => request("/appointments", { method: "POST", body: JSON.stringify(payload) }),
  updateAppointmentStatus: (id, statut) => request(`/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ statut }) }),

  getPatientDossier: (id) => request(`/patients/${id}/dossier`),
  searchPatients: (q) => request(`/patients/search?q=${encodeURIComponent(q)}`),
  searchConsultations: (q) => request(`/consultations/search?q=${encodeURIComponent(q)}`),

  listConsultations: () => request("/consultations"),
  createConsultation: (payload) => request("/consultations", { method: "POST", body: JSON.stringify(payload) }),

  listPrescriptions: () => request("/prescriptions"),
  createPrescription: (payload) => request("/prescriptions", { method: "POST", body: JSON.stringify(payload) }),
  // Le PDF est protégé par jeton : on le récupère via fetch (avec l'en-tête
  // Authorization) plutôt que par un lien direct, pour ne jamais exposer le
  // jeton de connexion dans une URL.
  downloadPrescriptionPdf: async (id, filename) => {
    const headers = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    let res;
    try {
      res = await fetch(`${API_URL}/prescriptions/${id}/pdf`, { headers });
    } catch (e) {
      throw new Error("Impossible de joindre le serveur pour générer le PDF. Vérifie qu'il est bien lancé et accessible (CORS).");
    }
    if (!res.ok) {
      let serverMsg = "";
      try { serverMsg = (await res.json()).error; } catch (e) { /* réponse non-JSON */ }
      throw new Error(serverMsg || `Impossible de générer le PDF de l'ordonnance (erreur ${res.status}).`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `ordonnance-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  listVitals: () => request("/vitals"),
  createVitals: (payload) => request("/vitals", { method: "POST", body: JSON.stringify(payload) }),

  listNotifications: () => request("/notifications"),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: () => request("/notifications/read-all", { method: "POST" }),

  listInvoices: () => request("/invoices"),
  createInvoice: (payload) => request("/invoices", { method: "POST", body: JSON.stringify(payload) }),
  updateInvoice: (id, payload) => request(`/invoices/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  downloadInvoicePdf: async (id, filename) => {
    const headers = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    let res;
    try {
      res = await fetch(`${API_URL}/invoices/${id}/pdf`, { headers });
    } catch (e) {
      throw new Error("Impossible de joindre le serveur pour générer le reçu. Vérifie qu'il est bien lancé et accessible (CORS).");
    }
    if (!res.ok) {
      let serverMsg = "";
      try { serverMsg = (await res.json()).error; } catch (e) { /* réponse non-JSON */ }
      throw new Error(serverMsg || `Impossible de générer le reçu PDF (erreur ${res.status}).`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `facture-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  listMedications: () => request("/medications"),
  createMedication: (payload) => request("/medications", { method: "POST", body: JSON.stringify(payload) }),
  updateMedication: (id, payload) => request(`/medications/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteMedication: (id) => request(`/medications/${id}`, { method: "DELETE" }),

  listAuditLog: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/audit-log${qs ? `?${qs}` : ""}`);
  },

  sendChatMessage: (message, history) => request("/chat", { method: "POST", body: JSON.stringify({ message, history }) }),

  getAvailability: (medecinId) => request(`/availability/${medecinId}`),
  getAvailableSlots: (medecinId, date) => request(`/availability/${medecinId}/slots?date=${encodeURIComponent(date)}`),
  addAvailabilitySlot: (medecinId, payload) => request(`/availability/${medecinId}/slots`, { method: "POST", body: JSON.stringify(payload) }),
  deleteAvailabilitySlot: (id) => request(`/availability/slots/${id}`, { method: "DELETE" }),
  addAbsence: (medecinId, payload) => request(`/availability/${medecinId}/absences`, { method: "POST", body: JSON.stringify(payload) }),
  deleteAbsence: (id) => request(`/availability/absences/${id}`, { method: "DELETE" }),

  updateMyPhoto: (photo) => request("/users/me/photo", { method: "PATCH", body: JSON.stringify({ photo }) }),
};
