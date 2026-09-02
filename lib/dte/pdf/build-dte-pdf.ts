import { jsPDF } from "jspdf";

import type { DtePdfBuildResult, DtePrintDocument } from "./pdf-types";

function money(value?: number | null): string {
  return `$${Math.round(value ?? 0).toLocaleString("es-CL")}`;
}

export function buildDtePdfLab(document: DtePrintDocument): DtePdfBuildResult {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 42;
  let y = 48;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(document.issuer.legalName, margin, y);
  y += 18;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`${document.issuer.rut} - ${document.issuer.businessActivity}`, margin, y);
  y += 14;
  pdf.text(`${document.issuer.address}, ${document.issuer.commune}`, margin, y);

  pdf.setDrawColor(220, 38, 38);
  pdf.rect(390, 42, 150, 70);
  pdf.setTextColor(153, 27, 27);
  pdf.setFont("helvetica", "bold");
  pdf.text(`RUT ${document.issuer.rut}`, 405, 62);
  pdf.text(document.documentType.toUpperCase(), 405, 82);
  pdf.text(`FOLIO ${document.folio}`, 405, 102);
  pdf.setTextColor(15, 23, 42);

  y = 140;
  if (document.environment !== "PRODUCTION") {
    pdf.setFillColor(255, 251, 235);
    pdf.setDrawColor(245, 158, 11);
    pdf.rect(margin, y, 510, 34, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(`MUESTRA ${document.environment} - no tiene validez tributaria productiva`, margin + 10, y + 21);
    y += 54;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Receptor", margin, y);
  pdf.text("Documento", 330, y);
  y += 16;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`${document.recipient.legalName} - ${document.recipient.rut}`, margin, y);
  pdf.text(`Fecha: ${document.issueDate}`, 330, y);
  y += 14;
  pdf.text(document.recipient.address ?? "", margin, y);
  pdf.text(`Estado: ${document.statusLabel}`, 330, y);
  y += 28;

  pdf.setFont("helvetica", "bold");
  pdf.text("Detalle", margin, y);
  pdf.text("Cant.", 335, y);
  pdf.text("Precio", 390, y);
  pdf.text("Monto", 470, y);
  y += 10;
  pdf.line(margin, y, 540, y);
  y += 18;

  pdf.setFont("helvetica", "normal");
  document.lines.forEach((line) => {
    pdf.text(line.name.slice(0, 42), margin, y);
    pdf.text(String(line.quantity), 340, y);
    pdf.text(money(line.unitPrice), 390, y);
    pdf.text(money(line.amount), 470, y);
    y += 18;
  });

  y += 18;
  pdf.text(`Neto: ${money(document.netAmount)}`, 390, y);
  y += 16;
  pdf.text(`IVA: ${money(document.taxAmount)}`, 390, y);
  y += 16;
  pdf.setFont("helvetica", "bold");
  pdf.text(`Total: ${money(document.totalAmount)}`, 390, y);
  y += 42;

  pdf.setDrawColor(148, 163, 184);
  pdf.rect(margin, y, 510, 62);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("TIMBRE ELECTRONICO / PDF417", margin + 150, y + 25);
  pdf.text("PENDIENTE: no representa timbre SII real", margin + 138, y + 43);

  return {
    ok: true,
    fileName: `dte-lab-${document.documentType}-${document.folio}.pdf`,
    dataUri: pdf.output("datauristring"),
    warnings: [
      "PDF de muestra LAB/CERTIFICATION sin timbre PDF417 real.",
      "No usar como documento tributario productivo hasta certificacion SII.",
    ],
    isProductionValid: false,
  };
}

