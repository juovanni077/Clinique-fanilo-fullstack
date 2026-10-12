const express = require("express");
const PDFDocument = require("pdfkit");
const db = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { newId, toPublicPrescription } = require("../utils/mappers");
const { validatePrescriptionPayload } = require("../utils/validate");
const { logAudit } = require("../utils/audit");
const { createNotification, sendEmailIfConfigured, notifyLowStockIfNeeded } = require("../utils/notify");
const { drawLetterhead } = require("../utils/pdf");

const router = express.Router();

router.get("/", authRequired, (req, res) => {
  if (req.user.role !== "patient") {
    return res.status(403).json({ error: "Utilisez /api/patients/:id/dossier pour consulter le dossier d'un patient." });
  }
  const rows = db.prepare("SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY date DESC").all(req.user.id);
  res.json(rows.map(toPublicPrescription));
});

router.post("/", authRequired, requireRole("medecin"), async (req, res) => {
  const b = req.body || {};
  const errors = validatePrescriptionPayload(b);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const patient = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'patient' AND deleted_at IS NULL").get(b.patientId);
  if (!patient) return res.status(400).json({ error: "Patient introuvable." });

  const id = newId("p");
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO prescriptions (id, patient_id, medecin_id, consultation_id, date, medicaments, instructions) VALUES (?,?,?,?,?,?,?)`)
    .run(id, b.patientId, req.user.id, b.consultationId || null, date, JSON.stringify(b.medicaments), b.instructions || null);

  // Décrémente le stock de pharmacie interne : de façon précise quand le
  // médecin a choisi le médicament dans la liste du stock (medicationId),
  // sinon par rapprochement du nom (pour une saisie libre qui correspondrait
  // par coïncidence à un article connu). C'est une décrémentation d'une
  // unité par ligne d'ordonnance, pas une gestion précise des quantités —
  // à affiner si besoin.
  const findMedById = db.prepare("SELECT * FROM medications WHERE id = ?");
  const findMedByName = db.prepare("SELECT * FROM medications WHERE LOWER(nom) = LOWER(?)");
  const decrementMed = db.prepare("UPDATE medications SET stock = MAX(0, stock - 1) WHERE id = ?");
  for (const m of b.medicaments) {
    let found = null;
    if (m.medicationId && typeof m.medicationId === "string") {
      found = findMedById.get(m.medicationId);
    }
    if (!found) {
      found = findMedByName.get(String(m.nom).trim());
    }
    if (found) {
      decrementMed.run(found.id);
      const updatedMed = db.prepare("SELECT * FROM medications WHERE id = ?").get(found.id);
      notifyLowStockIfNeeded(db, updatedMed, found.stock);
    }
  }

  const created = db.prepare("SELECT * FROM prescriptions WHERE id = ?").get(id);
  logAudit(req, { action: "create_prescription", targetPatientId: b.patientId, resourceType: "prescription", resourceId: id });

  createNotification({
    userId: patient.id, type: "prescription_created", titre: "Nouvelle ordonnance",
    message: `Une nouvelle ordonnance a été enregistrée par ${req.user.nom || "votre médecin"}. Tu peux la consulter et la télécharger en PDF depuis ton dossier.`,
  });
  sendEmailIfConfigured(patient.email, "Nouvelle ordonnance", "Une nouvelle ordonnance est disponible dans votre espace Clinique Fanilo.").catch(() => {});

  res.status(201).json(toPublicPrescription(created));
});

/** Génère un PDF imprimable de l'ordonnance, avec l'en-tête de la clinique. */
router.get("/:id/pdf", authRequired, (req, res) => {
  try {
    const rx = db.prepare("SELECT * FROM prescriptions WHERE id = ?").get(req.params.id);
    if (!rx) return res.status(404).json({ error: "Ordonnance introuvable." });

    const { role, id: requesterId } = req.user;
    const isOwner = role === "patient" && rx.patient_id === requesterId;
    const isPrescriber = role === "medecin" && rx.medecin_id === requesterId;
    const isStaff = role === "admin" || role === "infirmiere";
    if (!isOwner && !isPrescriber && !isStaff) {
      return res.status(403).json({ error: "Accès refusé." });
    }

    const patient = db.prepare("SELECT * FROM users WHERE id = ?").get(rx.patient_id);
    const medecin = db.prepare("SELECT * FROM users WHERE id = ?").get(rx.medecin_id);
    const medicaments = JSON.parse(rx.medicaments);

    logAudit(req, { action: "download_prescription_pdf", targetPatientId: rx.patient_id, resourceType: "prescription", resourceId: rx.id });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="ordonnance-${rx.id}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    // Le flux d'écriture (doc -> res) peut émettre une erreur de façon
    // asynchrone (ex. connexion coupée par le client) — un 'error' non
    // écouté sur un flux peut faire planter tout le process Node, ce
    // qu'un simple try/catch ne rattrape pas puisque c'est asynchrone.
    doc.on("error", (e) => console.error("Erreur du flux PDF (ordonnance) :", e));
    res.on("error", (e) => console.error("Erreur de la réponse HTTP (ordonnance) :", e));
    doc.pipe(res);

  drawLetterhead(doc, { title: "Ordonnance médicale" });

  // Bloc infos : médecin / patient, sur deux colonnes bien espacées pour rester lisible.
  const colY = doc.y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#78716c").text("PRESCRIT PAR", 50, colY);
  doc.font("Helvetica").fontSize(11).fillColor("#1c1917").text(medecin ? medecin.nom : "—", 50, colY + 14);
  if (medecin && medecin.specialite) doc.fontSize(9).fillColor("#78716c").text(medecin.specialite, 50, colY + 30);

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#78716c").text("PATIENT", 310, colY);
  doc.font("Helvetica").fontSize(11).fillColor("#1c1917").text(patient ? patient.nom : "—", 310, colY + 14);
  if (patient && patient.date_naissance) doc.fontSize(9).fillColor("#78716c").text(`Né(e) le ${patient.date_naissance}`, 310, colY + 30);

  doc.y = colY + 52;
  doc.font("Helvetica").fontSize(9).fillColor("#78716c").text(`Date de l'ordonnance : ${rx.date}`, 50, doc.y);
  doc.moveDown(1.2);

  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(13).fillColor("#115e59").text("Médicaments prescrits");
  doc.moveDown(0.6);

  medicaments.forEach((m, i) => {
    // Saut de page si la prochaine ligne dépasserait le bas de la page —
    // sans ça, une ordonnance avec beaucoup de médicaments dessinait des
    // lignes en dehors de la page (perdues, jamais visibles à l'impression).
    if (doc.y + 44 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const rowY = doc.y;
    doc.roundedRect(50, rowY, 495, 44, 6).fillAndStroke("#f5f5f4", "#e7e5e4");
    doc.fillColor("#1c1917").font("Helvetica-Bold").fontSize(12).text(`${i + 1}.  ${m.nom}`, 62, rowY + 8);
    doc.font("Helvetica").fontSize(10).fillColor("#57534e").text(
      `${m.dosage || "—"}   ·   ${m.frequence || "—"}   ·   ${m.duree || "—"}`,
      62, rowY + 26
    );
    doc.y = rowY + 44 + 10;
  });

  if (rx.instructions) {
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#1c1917").text("Instructions particulières");
    doc.font("Helvetica").fontSize(10).fillColor("#44403c").text(rx.instructions, { width: 495 });
  }

  doc.moveDown(2.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(8).fillColor("#a8a29e").text(
    "Document généré électroniquement par Clinique Fanilo — à conserver et présenter en pharmacie.",
    { align: "center" }
  );

  doc.end();
  } catch (e) {
    console.error("Erreur lors de la génération du PDF d'ordonnance :", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur lors de la génération du PDF." });
    } else {
      res.end();
    }
  }
});

module.exports = router;
