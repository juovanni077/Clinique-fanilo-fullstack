const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "..", "clinique.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* ------------------------------------------------------------------ */
/* Schéma                                                              */
/* ------------------------------------------------------------------ */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('admin','medecin','infirmiere','patient')),
  nom TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  telephone TEXT,
  specialite TEXT,
  service TEXT,
  date_naissance TEXT,
  sexe TEXT,
  groupe_sanguin TEXT,
  allergies TEXT,
  adresse TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  medecin_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  heure TEXT NOT NULL,
  motif TEXT,
  statut TEXT NOT NULL DEFAULT 'planifié' CHECK(statut IN ('planifié','confirmé','terminé','annulé')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consultations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  medecin_id TEXT NOT NULL REFERENCES users(id),
  appointment_id TEXT REFERENCES appointments(id),
  date TEXT NOT NULL,
  diagnostic TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  medecin_id TEXT NOT NULL REFERENCES users(id),
  consultation_id TEXT REFERENCES consultations(id),
  date TEXT NOT NULL,
  medicaments TEXT NOT NULL,
  instructions TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vitals (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  infirmiere_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  tension TEXT,
  temperature TEXT,
  pouls TEXT,
  poids TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_nom TEXT,
  user_role TEXT,
  action TEXT NOT NULL,
  target_patient_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_target_patient ON audit_logs(target_patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  titre TEXT NOT NULL,
  message TEXT NOT NULL,
  appointment_id TEXT,
  lu INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  appointment_id TEXT REFERENCES appointments(id),
  consultation_id TEXT REFERENCES consultations(id),
  libelle TEXT NOT NULL,
  montant INTEGER NOT NULL,
  devise TEXT NOT NULL DEFAULT 'Ar',
  statut TEXT NOT NULL DEFAULT 'impayé' CHECK(statut IN ('impayé','payé','annulé')),
  mode_paiement TEXT,
  assurance TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoice_patient ON invoices(patient_id);

CREATE TABLE IF NOT EXISTS medications (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  unite TEXT NOT NULL DEFAULT 'unité',
  stock INTEGER NOT NULL DEFAULT 0,
  seuil_alerte INTEGER NOT NULL DEFAULT 10,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  medecin_id TEXT NOT NULL REFERENCES users(id),
  jour_semaine INTEGER NOT NULL CHECK(jour_semaine BETWEEN 0 AND 6), -- 0 = dimanche ... 6 = samedi
  heure_debut TEXT NOT NULL,
  heure_fin TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_availability_medecin ON availability(medecin_id);

CREATE TABLE IF NOT EXISTS absences (
  id TEXT PRIMARY KEY,
  medecin_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  motif TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_absences_medecin ON absences(medecin_id, date);
`);

/* ------------------------------------------------------------------ */
/* Migration légère : ajoute deleted_at si la base existait déjà avant  */
/* l'introduction de la corbeille (CREATE TABLE IF NOT EXISTS ne modifie */
/* pas une table existante).                                            */
/* ------------------------------------------------------------------ */
{
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("deleted_at")) {
    db.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT DEFAULT NULL");
    console.log("Migration : colonne deleted_at ajoutée à la table users.");
  }
  if (!cols.includes("photo")) {
    db.exec("ALTER TABLE users ADD COLUMN photo TEXT DEFAULT NULL");
    console.log("Migration : colonne photo ajoutée à la table users.");
  }
}

/* ------------------------------------------------------------------ */
/* Données de démonstration (une seule fois, si la base est vide)      */
/* ------------------------------------------------------------------ */
function seedIfEmpty() {
  const { c } = db.prepare("SELECT COUNT(*) as c FROM users").get();
  if (c > 0) return;

  const hash = (pwd) => bcrypt.hashSync(pwd, 10);
  const id = () => crypto.randomUUID();

  const admin = { id: "u-" + id() };
  const med1 = { id: "u-" + id() };
  const med2 = { id: "u-" + id() };
  const inf1 = { id: "u-" + id() };
  const pat1 = { id: "u-" + id() };
  const pat2 = { id: "u-" + id() };

  const insertUser = db.prepare(`
    INSERT INTO users (id, role, nom, email, password_hash, telephone, specialite, service, date_naissance, sexe, groupe_sanguin, allergies, adresse)
    VALUES (@id, @role, @nom, @email, @password_hash, @telephone, @specialite, @service, @date_naissance, @sexe, @groupe_sanguin, @allergies, @adresse)
  `);

  insertUser.run({ id: admin.id, role: "admin", nom: "Florio Juovanni", email: "juovann35@gmail.com", password_hash: hash("admin123"), telephone: "034 00 111 22", specialite: null, service: null, date_naissance: null, sexe: null, groupe_sanguin: null, allergies: null, adresse: null });
  insertUser.run({ id: med1.id, role: "medecin", nom: "Dr. Voahangy Rasoamanana", email: "voahangy@gmail.com", password_hash: hash("medecin123"), telephone: "032 11 222 33", specialite: "Cardiologie", service: null, date_naissance: null, sexe: null, groupe_sanguin: null, allergies: null, adresse: null });
  insertUser.run({ id: med2.id, role: "medecin", nom: "Dr. Tojo Randrianarisoa", email: "tojo@gmail.com", password_hash: hash("medecin123"), telephone: "033 22 333 44", specialite: "Pédiatrie", service: null, date_naissance: null, sexe: null, groupe_sanguin: null, allergies: null, adresse: null });
  insertUser.run({ id: inf1.id, role: "infirmiere", nom: "Fara Ravaoarimalala", email: "fara@gmail.com", password_hash: hash("infirmiere123"), telephone: "034 44 555 66", specialite: null, service: "Soins généraux", date_naissance: null, sexe: null, groupe_sanguin: null, allergies: null, adresse: null });
  insertUser.run({ id: pat1.id, role: "patient", nom: "Nirina Rakotomalala", email: "nirina@gmail.com", password_hash: hash("patient123"), telephone: "032 55 666 77", specialite: null, service: null, date_naissance: "1988-04-12", sexe: "F", groupe_sanguin: "O+", allergies: "Pénicilline", adresse: "Lot II M 12, Ankadifotsy, Antananarivo" });
  insertUser.run({ id: pat2.id, role: "patient", nom: "Lova Andriamahefa", email: "lova@gmail.com", password_hash: hash("patient123"), telephone: "033 66 777 88", specialite: null, service: null, date_naissance: "2015-09-02", sexe: "M", groupe_sanguin: "A+", allergies: "Aucune connue", adresse: "Ambohipo, Antananarivo" });

  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(); past.setDate(past.getDate() - 5);
  const pastISO = past.toISOString().slice(0, 10);
  const soon = new Date(); soon.setDate(soon.getDate() + 2);
  const soonISO = soon.toISOString().slice(0, 10);

  const apptDoneId = "a-" + id();
  const insertAppt = db.prepare(`INSERT INTO appointments (id, patient_id, medecin_id, date, heure, motif, statut) VALUES (?,?,?,?,?,?,?)`);
  insertAppt.run(apptDoneId, pat1.id, med1.id, pastISO, "09:30", "Douleurs thoraciques occasionnelles", "terminé");
  insertAppt.run("a-" + id(), pat2.id, med2.id, today, "14:00", "Contrôle de croissance", "confirmé");
  insertAppt.run("a-" + id(), pat1.id, med1.id, soonISO, "10:00", "Suivi tension artérielle", "planifié");

  const consultId = "c-" + id();
  db.prepare(`INSERT INTO consultations (id, patient_id, medecin_id, appointment_id, date, diagnostic, notes) VALUES (?,?,?,?,?,?,?)`)
    .run(consultId, pat1.id, med1.id, apptDoneId, pastISO, "Hypertension artérielle légère", "Tension à 14/9. Réduire le sel, reprendre une activité physique modérée. Contrôle dans 2 semaines.");

  db.prepare(`INSERT INTO prescriptions (id, patient_id, medecin_id, consultation_id, date, medicaments, instructions) VALUES (?,?,?,?,?,?,?)`)
    .run("p-" + id(), pat1.id, med1.id, consultId, pastISO,
      JSON.stringify([{ nom: "Amlodipine", dosage: "5 mg", frequence: "1x / jour", duree: "14 jours" }]),
      "À prendre le matin, de préférence à jeun. Éviter le pamplemousse.");

  const insertVitals = db.prepare(`INSERT INTO vitals (id, patient_id, infirmiere_id, date, tension, temperature, pouls, poids, notes) VALUES (?,?,?,?,?,?,?,?,?)`);
  // Deux mesures espacées dans le temps pour que la courbe d'évolution
  // (qui a besoin d'au moins 2 points) ait quelque chose à afficher.
  const before = new Date(); before.setDate(before.getDate() - 12);
  insertVitals.run("v-" + id(), pat1.id, inf1.id, before.toISOString().slice(0, 10), "15/9", "37.0", "82", "69", "Première prise avant début du traitement.");
  insertVitals.run("v-" + id(), pat1.id, inf1.id, pastISO, "14/9", "36.8", "78", "68", "Patiente calme, aucune plainte particulière.");

  // Facturation de démonstration, liée à la consultation déjà terminée.
  db.prepare(`INSERT INTO invoices (id, patient_id, appointment_id, consultation_id, libelle, montant, statut) VALUES (?,?,?,?,?,?,?)`)
    .run("inv-" + id(), pat1.id, apptDoneId, consultId, "Consultation cardiologie — Dr. Rasoamanana", 40000, "impayé");

  // Stock de pharmacie de démonstration.
  const insertMed = db.prepare(`INSERT INTO medications (id, nom, unite, stock, seuil_alerte) VALUES (?,?,?,?,?)`);
  insertMed.run("m-" + id(), "Amlodipine 5 mg", "boîte", 42, 15);
  insertMed.run("m-" + id(), "Paracétamol 500 mg", "boîte", 120, 30);
  insertMed.run("m-" + id(), "Amoxicilline 500 mg", "boîte", 8, 15);
  insertMed.run("m-" + id(), "Sérum physiologique", "flacon", 60, 20);

  // L'Amoxicilline démarre déjà sous son seuil d'alerte (8 < 15). En temps
  // normal c'est notifyLowStockIfNeeded (utils/notify.js) qui prévient les
  // admins, mais elle ne se déclenche que sur un FRANCHISSEMENT du seuil
  // pendant que l'appli tourne (pour ne pas spammer) — un stock déjà bas
  // dès le départ ne déclenchait donc jamais rien. On crée ici la
  // notification correspondante directement, une fois, au démarrage.
  db.prepare(`INSERT INTO notifications (id, user_id, type, titre, message) VALUES (?,?,?,?,?)`)
    .run("n-" + id(), admin.id, "low_stock", "Stock bas", "Amoxicilline 500 mg passe sous le seuil d'alerte : il reste 8 boîte.");

  // Disponibilités de démonstration : Dr. Rasoamanana du lundi au vendredi
  // matin, Dr. Randrianarisoa lundi/mercredi/vendredi après-midi ET
  // mardi/jeudi matin (semaine plus complète pour tester le calendrier).
  const insertAvail = db.prepare(`INSERT INTO availability (id, medecin_id, jour_semaine, heure_debut, heure_fin) VALUES (?,?,?,?,?)`);
  for (let jour = 1; jour <= 5; jour++) {
    insertAvail.run("av-" + id(), med1.id, jour, "08:00", "12:00");
  }
  [1, 3, 5].forEach((jour) => {
    insertAvail.run("av-" + id(), med2.id, jour, "14:00", "17:30");
  });
  [2, 4].forEach((jour) => {
    insertAvail.run("av-" + id(), med2.id, jour, "09:00", "12:00");
  });

  // Une absence de démonstration (dans les 2 semaines à venir) pour
  // pouvoir tester tout de suite le comportement "jour d'absence" côté
  // prise de rendez-vous, sans avoir à en créer une manuellement.
  const absenceDate = new Date(); absenceDate.setDate(absenceDate.getDate() + 9);
  db.prepare(`INSERT INTO absences (id, medecin_id, date, motif) VALUES (?,?,?,?)`)
    .run("abs-" + id(), med1.id, absenceDate.toISOString().slice(0, 10), "Formation continue");

  console.log("Base de données initialisée avec les comptes de démonstration.");
}

seedIfEmpty();

module.exports = db;
