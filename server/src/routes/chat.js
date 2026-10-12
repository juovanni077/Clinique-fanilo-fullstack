const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const { logAudit } = require("../utils/audit");

const router = express.Router();

// Nom du modèle Gemini à utiliser. Google fait évoluer régulièrement ses
// noms de modèles — si le chat renvoie une erreur 404 "model ... is no
// longer available", change simplement GEMINI_MODEL dans server/.env avec
// le nom recommandé dans le message d'erreur (visible dans les logs du
// serveur), sans avoir besoin de modifier ce fichier.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

/**
 * Construit le "system prompt" et le contexte de données propres au rôle
 * connecté. Chaque rôle ne voit QUE ses propres données — le chatbot n'a
 * pas plus d'accès que l'utilisateur qui lui parle.
 */
function buildSystemPrompt(user) {
  const base = `Tu es l'assistant intégré de "Clinique Fanilo", une application de gestion de clinique médicale à Antananarivo, Madagascar. Tu réponds par défaut en français, de façon concise, chaleureuse et utile. Tu comprends aussi le malgache et l'anglais : réponds toujours dans la langue utilisée par la personne dans son dernier message (si elle écrit en malgache, réponds en malgache ; en anglais, réponds en anglais ; si elle mélange plusieurs langues, tu peux faire pareil naturellement). Tu ne dois jamais prétendre être un humain. Tu n'as accès qu'aux informations fournies ci-dessous — ne invente jamais de données précises (dates, noms, chiffres) qui n'y figurent pas.`;

  if (user.role === "admin") {
    const patients = db.prepare("SELECT COUNT(*) c FROM users WHERE role='patient' AND deleted_at IS NULL").get().c;
    const medecins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='medecin' AND deleted_at IS NULL").get().c;
    const infirmieres = db.prepare("SELECT COUNT(*) c FROM users WHERE role='infirmiere' AND deleted_at IS NULL").get().c;
    const today = new Date().toISOString().slice(0, 10);
    const rdvAuj = db.prepare("SELECT COUNT(*) c FROM appointments WHERE date = ?").get(today).c;
    const impayees = db.prepare("SELECT COUNT(*) c FROM invoices WHERE statut = 'impayé'").get().c;
    return `${base}
Tu aides ${user.nom}, administrateur de la clinique. Tu peux répondre à des questions sur le fonctionnement de l'application (rendez-vous, personnel, facturation, pharmacie, journal d'audit) et sur les chiffres ci-dessous. Tu n'as pas accès au détail des dossiers médicaux des patients — pour ça, renvoie vers la page "Personnel & patients".
Données actuelles :
- Patients actifs : ${patients}
- Médecins actifs : ${medecins}
- Infirmières actives : ${infirmieres}
- Rendez-vous aujourd'hui : ${rdvAuj}
- Factures impayées : ${impayees}`;
  }

  if (user.role === "medecin") {
    const upcoming = db.prepare(`
      SELECT a.date, a.heure, a.motif, u.nom as patient_nom FROM appointments a
      JOIN users u ON u.id = a.patient_id
      WHERE a.medecin_id = ? AND a.statut IN ('planifié','confirmé') AND a.date >= date('now')
      ORDER BY a.date, a.heure LIMIT 5
    `).all(user.id);
    const list = upcoming.length
      ? upcoming.map((a) => `  - ${a.date} ${a.heure} : ${a.patient_nom} (${a.motif})`).join("\n")
      : "  (aucun rendez-vous à venir)";
    return `${base}
Tu aides ${user.nom}, médecin (${user.specialite || "spécialité non renseignée"}). Tu peux discuter de questions médicales générales, aider à formuler ou reformuler des notes de consultation, résumer des informations. Tu n'établis JAMAIS de diagnostic définitif à sa place et tu rappelles que la décision clinique finale lui revient toujours — tu es une aide à la réflexion, pas une autorité médicale.
Ses prochains rendez-vous :
${list}`;
  }

  if (user.role === "infirmiere") {
    const today = new Date().toISOString().slice(0, 10);
    const mesuresAuj = db.prepare("SELECT COUNT(*) c FROM vitals WHERE infirmiere_id = ? AND date = ?").get(user.id, today).c;
    return `${base}
Tu aides ${user.nom}, infirmière (service : ${user.service || "non renseigné"}). Tu peux répondre à des questions générales de soins infirmiers, aider à interpréter une tendance de constantes vitales (dans un cadre pédagogique, jamais comme un diagnostic), et orienter dans l'application. Pour toute décision clinique, rappelle de se référer au médecin.
Mesures qu'elle a prises aujourd'hui : ${mesuresAuj}`;
  }

  // patient
  const allergies = user.allergies && !String(user.allergies).toLowerCase().includes("aucun") ? user.allergies : "aucune connue";
  const nextAppt = db.prepare(`
    SELECT a.date, a.heure, u.nom as medecin_nom FROM appointments a
    JOIN users u ON u.id = a.medecin_id
    WHERE a.patient_id = ? AND a.statut IN ('planifié','confirmé') AND a.date >= date('now')
    ORDER BY a.date, a.heure LIMIT 1
  `).get(user.id);
  const lastRx = db.prepare(`SELECT date, medicaments FROM prescriptions WHERE patient_id = ? ORDER BY date DESC LIMIT 1`).get(user.id);
  let lastRxText = "aucune";
  if (lastRx) {
    try {
      const meds = JSON.parse(lastRx.medicaments).map((m) => m.nom).join(", ");
      lastRxText = `du ${lastRx.date} (${meds})`;
    } catch { lastRxText = `du ${lastRx.date}`; }
  }

  return `${base}
Tu aides ${user.nom}, patient de la clinique. Tu peux répondre à ses questions de santé générales de façon prudente, claire et pédagogique — mais avec des règles STRICTES :
- Tu ne poses JAMAIS de diagnostic définitif. Tu peux évoquer des pistes générales, toujours en recommandant de consulter un médecin pour confirmation.
- Tu ne donnes JAMAIS de posologie précise au-delà de ce qui est déjà indiqué dans son ordonnance existante.
- Si les symptômes décrits semblent sérieux, inhabituels, ou pourraient être une urgence (douleur thoracique, difficulté à respirer, saignement important, perte de conscience, etc.), dis-lui clairement de consulter en urgence ou d'appeler les secours immédiatement, avant toute autre réponse.
- Tu tiens compte de ses allergies connues si la question porte sur un médicament.
- Tu n'es pas un substitut à une consultation médicale et tu le rappelles si la question s'y prête.
Son dossier :
- Allergies connues : ${allergies}
- Groupe sanguin : ${user.groupeSanguin || "non renseigné"}
- Prochain rendez-vous : ${nextAppt ? `${nextAppt.date} à ${nextAppt.heure} avec ${nextAppt.medecin_nom}` : "aucun"}
- Dernière ordonnance : ${lastRxText}`;
}

router.post("/", authRequired, async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message vide." });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: "Message trop long (4000 caractères maximum)." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "L'assistant n'est pas configuré. L'administrateur doit renseigner GEMINI_API_KEY dans server/.env (clé gratuite sur aistudio.google.com).",
    });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(req.user.id);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });

  const systemPrompt = buildSystemPrompt(user);

  // L'historique vient du client (mémoire de conversation côté navigateur
  // uniquement — rien n'est stocké côté serveur). On le borne pour éviter
  // un payload excessif.
  const safeHistory = Array.isArray(history) ? history.slice(-12) : [];
  const contents = [
    ...safeHistory
      .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string")
      .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, 4000) }] })),
    { role: "user", parts: [{ text: message.trim() }] },
  ];

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error("Erreur API Gemini :", response.status, errBody);
      return res.status(502).json({ error: "L'assistant IA n'a pas pu répondre pour le moment. Réessaie dans un instant." });
    }

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || null;
    if (!reply) {
      return res.status(502).json({ error: "L'assistant n'a pas pu générer de réponse. Réessaie en reformulant ta question." });
    }

    logAudit(req, { action: "chat_message", resourceType: "chat" });
    res.json({ reply });
  } catch (e) {
    console.error("Erreur d'appel à l'assistant IA :", e.message);
    res.status(502).json({ error: "Impossible de joindre l'assistant IA. Vérifie la connexion internet du serveur." });
  }
});

module.exports = router;
