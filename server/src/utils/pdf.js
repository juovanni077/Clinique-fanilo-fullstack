// En-tête commun (logo + nom + adresse) pour tous les documents PDF de la
// clinique (ordonnances, factures...). On dessine le logo directement en
// formes vectorielles avec pdfkit — pas besoin de fichier image externe,
// et le rendu reste net à n'importe quelle taille d'impression.

const BRAND_TEAL = "#115e59";
const BRAND_TEAL_DARK = "#0c4a44";

function drawLetterhead(doc, { title } = {}) {
  const startY = doc.y;

  // Monogramme : carré arrondi teal avec les initiales en blanc.
  doc.roundedRect(50, startY, 42, 42, 10).fill(BRAND_TEAL);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18);
  doc.text("CF", 50, startY + 12, { width: 42, align: "center" });

  // Nom et adresse de la clinique, à droite du monogramme.
  doc.fillColor(BRAND_TEAL_DARK).font("Helvetica-Bold").fontSize(20);
  doc.text("Clinique Fanilo", 102, startY + 2);
  doc.fillColor("#6b7280").font("Helvetica").fontSize(10);
  doc.text("Antananarivo, Madagascar", 102, startY + 24);

  doc.y = startY + 56;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.moveDown(1);

  if (title) {
    doc.fillColor("#1c1917").font("Helvetica-Bold").fontSize(15);
    doc.text(title);
    doc.moveDown(0.8);
  }
  doc.fillColor("#1c1917").font("Helvetica").fontSize(11);
}

module.exports = { drawLetterhead, BRAND_TEAL };
