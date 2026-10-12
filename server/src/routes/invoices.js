const express = require("express");
const PDFDocument = require("pdfkit");
const db = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { newId } = require("../utils/mappers");
const { isNonEmptyString, isOneOf } = require("../utils/validate");
const { logAudit } = require("../utils/audit");
const { createNotification } = require("../utils/notify");
const { drawLetterhead } = require("../utils/pdf");

// Formatage manuel (espace normale entre les milliers) — toLocaleString("fr-FR")
// utilise un caractère d'espacement spécial que la police du PDF n'affichait
// pas correctement (il apparaissait comme un symbole gênant, ex. "/").
const fmtMontant = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const router = express.Router();

function toPublic(row) {
  return {
    id: row.id, patientId: row.patient_id, appointmentId: row.appointment_id,
    consultationId: row.consultation_id, libelle: row.libelle, montant: row.montant,
    devise: row.devise, statut: row.statut, modePaiement: row.mode_paiement,
    assurance: row.assurance, createdAt: row.created_at, paidAt: row.paid_at,
  };
}

// Le patient voit ses propres factures ; admin voit tout.
router.get("/", authRequired, (req, res) => {
  const { role, id } = req.user;
  let rows;
  if (role === "admin") {
    rows = db.prepare("SELECT * FROM invoices ORDER BY created_at DESC").all();
  } else if (role === "patient") {
    rows = db.prepare("SELECT * FROM invoices WHERE patient_id = ? ORDER BY created_at DESC").all(id);
  } else {
    return res.status(403).json({ error: "Accès refusé." });
  }
  res.json(rows.map(toPublic));
});

router.post("/", authRequired, requireRole("admin"), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.patientId, 100)) return res.status(400).json({ error: "patientId requis." });
  if (!isNonEmptyString(b.libelle, 200)) return res.status(400).json({ error: "Le libellé est requis." });
  if (typeof b.montant !== "number" || b.montant <= 0) return res.status(400).json({ error: "Le montant doit être un nombre positif." });

  const patient = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'patient' AND deleted_at IS NULL").get(b.patientId);
  if (!patient) return res.status(400).json({ error: "Patient introuvable." });

  const id = newId("inv");
  db.prepare(`
    INSERT INTO invoices (id, patient_id, appointment_id, consultation_id, libelle, montant, devise, statut, assurance)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, b.patientId, b.appointmentId || null, b.consultationId || null, b.libelle, Math.round(b.montant), b.devise || "Ar", "impayé", b.assurance || null);

  const created = db.prepare("SELECT * FROM invoices WHERE id = ?").get(id);
  logAudit(req, { action: "create_invoice", targetPatientId: b.patientId, resourceType: "invoice", resourceId: id });
  createNotification({
    userId: patient.id, type: "invoice_created", titre: "Nouvelle facture",
    message: `Une facture de ${fmtMontant(created.montant)} ${created.devise} (${created.libelle}) a été émise.`,
  });

  res.status(201).json(toPublic(created));
});

router.patch("/:id", authRequired, requireRole("admin"), (req, res) => {
  const b = req.body || {};
  const existing = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable." });
  if (b.statut && !isOneOf(b.statut, ["impayé", "payé", "annulé"])) {
    return res.status(400).json({ error: "Statut invalide." });
  }

  const paidAt = b.statut === "payé" ? new Date().toISOString() : existing.paid_at;
  db.prepare("UPDATE invoices SET statut = ?, mode_paiement = ?, paid_at = ? WHERE id = ?")
    .run(b.statut || existing.statut, b.modePaiement ?? existing.mode_paiement, paidAt, req.params.id);

  const updated = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  logAudit(req, { action: "update_invoice", targetPatientId: existing.patient_id, resourceType: "invoice", resourceId: existing.id, detail: `nouveau statut : ${updated.statut}` });
  res.json(toPublic(updated));
});

/** Génère un reçu PDF imprimable de la facture, avec tampon PAYÉ si réglée. */
router.get("/:id/pdf", authRequired, (req, res) => {
  try {
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!inv) return res.status(404).json({ error: "Facture introuvable." });

    const { role, id: requesterId } = req.user;
    if (role !== "admin" && !(role === "patient" && inv.patient_id === requesterId)) {
      return res.status(403).json({ error: "Accès refusé." });
    }

    const patient = db.prepare("SELECT * FROM users WHERE id = ?").get(inv.patient_id);

    logAudit(req, { action: "download_invoice_pdf", targetPatientId: inv.patient_id, resourceType: "invoice", resourceId: inv.id });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="facture-${inv.id}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.on("error", (e) => console.error("Erreur du flux PDF (facture) :", e));
    res.on("error", (e) => console.error("Erreur de la réponse HTTP (facture) :", e));
    doc.pipe(res);

  drawLetterhead(doc, { title: "Reçu de facturation" });

  const colY = doc.y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#78716c").text("FACTURÉ À", 50, colY);
  doc.font("Helvetica").fontSize(12).fillColor("#1c1917").text(patient ? patient.nom : "—", 50, colY + 14);
  if (patient && patient.telephone) doc.fontSize(9).fillColor("#78716c").text(patient.telephone, 50, colY + 32);

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#78716c").text("N° DE FACTURE", 310, colY);
  doc.font("Helvetica").fontSize(11).fillColor("#1c1917").text(inv.id, 310, colY + 14);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#78716c").text("DATE D'ÉMISSION", 310, colY + 32);
  doc.font("Helvetica").fontSize(11).fillColor("#1c1917").text((inv.created_at || "").slice(0, 10), 310, colY + 46);

  doc.y = colY + 75;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.moveDown(1.2);

  // Tableau à une ligne : libellé + montant, bien lisible.
  const rowY = doc.y;
  doc.roundedRect(50, rowY, 495, 56, 8).fillAndStroke("#f5f5f4", "#e7e5e4");
  doc.fillColor("#1c1917").font("Helvetica-Bold").fontSize(12).text(inv.libelle, 66, rowY + 12, { width: 320 });
  if (inv.assurance) doc.font("Helvetica").fontSize(9).fillColor("#78716c").text(`Assurance : ${inv.assurance}`, 66, rowY + 32);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#115e59").text(
    `${fmtMontant(inv.montant)} ${inv.devise}`, 350, rowY + 16, { width: 175, align: "right" }
  );
  doc.y = rowY + 56 + 30;

  // Tampon de statut, bien visible.
  const stampColors = { "payé": "#047857", "impayé": "#b45309", "annulé": "#be123c" };
  const stampLabels = { "payé": "PAYÉ", "impayé": "EN ATTENTE DE PAIEMENT", "annulé": "ANNULÉE" };
  const stampColor = stampColors[inv.statut] || "#78716c";
  doc.save();
  doc.lineWidth(2.5).strokeColor(stampColor).roundedRect(50, doc.y, 220, 40, 8).stroke();
  doc.font("Helvetica-Bold").fontSize(14).fillColor(stampColor).text(stampLabels[inv.statut] || inv.statut.toUpperCase(), 50, doc.y + 13, { width: 220, align: "center" });
  doc.restore();
  doc.y += 60;

  if (inv.statut === "payé" && inv.mode_paiement) {
    doc.font("Helvetica").fontSize(10).fillColor("#57534e").text(`Mode de paiement : ${inv.mode_paiement}`);
    if (inv.paid_at) doc.text(`Payée le : ${String(inv.paid_at).slice(0, 10)}`);
    doc.moveDown(0.6);
  }

  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(8).fillColor("#a8a29e").text(
    "Reçu généré électroniquement par Clinique Fanilo.", { align: "center" }
  );

  doc.end();
  } catch (e) {
    console.error("Erreur lors de la génération du reçu PDF :", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur lors de la génération du PDF." });
    } else {
      res.end();
    }
  }
});

module.exports = router;
