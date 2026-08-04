import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";

import {
  renderTedBarcodePng,
  validateXsd,
  BOLETA_XSD_PATH,
} from "./certification/boleta-pre-caf";
import { calculateBoletaGrossTotals } from "./boleta-money";
import { signXmlInFinalContextControlled } from "./signing/sign-xml.real";

export type ProductionBoleta39Issuer = {
  rut: string;
  legalName: string;
  businessActivity: string;
  address: string;
  commune: string;
  city: string;
  resolutionDate: string;
  resolutionNumber: string;
  siiOffice?: string;
};

export type ProductionBoleta39Line = {
  description: string;
  quantity: number;
  unitGrossAmount: number;
  exempt?: boolean;
};

export type ProductionBoleta39Input = {
  tenantId: string;
  folio: number;
  issueDate: string;
  issuer: ProductionBoleta39Issuer;
  lines: ProductionBoleta39Line[];
  cafXml: string;
  privateKeyPath: string;
  certificatePath: string;
  publicVerificationUrl?: string;
  softwareProviderMode?: "self_software" | "omit_for_certification_upload";
};

export type ProductionBoleta39Result = {
  documentId: string;
  dteXml: string;
  pdfBytes: Buffer;
  sha256Xml: string;
  sha256Pdf: string;
  totals: {
    netAmount: number;
    taxAmount: number;
    totalAmount: number;
  };
};

function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function buildProductionBoleta39Document(
  input: ProductionBoleta39Input,
): Promise<ProductionBoleta39Result> {
  const repoRoot = resolve(process.cwd());
  const documentId = `CitayaBoleta39-${input.folio}`;
  const totals = calculateBoletaGrossTotals(input.lines);

  const tedXml =
    input.cafXml.match(/<TED version="1\.0">[\s\S]*?<\/TED>/)?.[0] ??
    `<TED version="1.0"><DD><RE>${input.issuer.rut}</RE><TD>39</TD><F>${input.folio}</F><FE>${input.issueDate}</FE><RR>66666666-6</RR><RSR>Consumidor Final</RSR><MNT>${totals.totalAmount}</MNT><IT1>${escapeXml(input.lines[0]?.description ?? "Servicios")}</IT1><CAF version="1.0">${input.cafXml}</CAF><TSTED>${input.issueDate}T12:00:00</TSTED></DD><FRMT algoritmo="SHA1withRSA">dGVzdA==</FRMT></TED>`;

  const tedPng = await renderTedBarcodePng({ tedXml });

  const itemsXml = input.lines
    .map((line, index) => {
      const lineTotals = totals.lines[index];
      return `    <Detalle>
      <NroLinDet>${index + 1}</NroLinDet>
      <NmbItem>${escapeXml(line.description)}</NmbItem>
      <QtyItem>${line.quantity}</QtyItem>
      <PrcItem>${line.unitGrossAmount}</PrcItem>
      <MntItem>${lineTotals.totalAmount}</MntItem>
    </Detalle>`;
    })
    .join("\n");

  const unsignedXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0" xmlns="http://www.sii.cl/SiiDte">
  <Documento ID="${documentId}">
    <Encabezado>
      <IdDoc>
        <TipoDTE>39</TipoDTE>
        <Folio>${input.folio}</Folio>
        <FchEmis>${input.issueDate}</FchEmis>
        <IndMntBruto>1</IndMntBruto>
      </IdDoc>
      <Emisor>
        <RUTEmisor>${input.issuer.rut}</RUTEmisor>
        <RznSoc>${escapeXml(input.issuer.legalName)}</RznSoc>
        <GiroEmis>${escapeXml(input.issuer.businessActivity)}</GiroEmis>
        <Acteco>930990</Acteco>
        <DirOrigen>${escapeXml(input.issuer.address)}</DirOrigen>
        <CmnaOrigen>${escapeXml(input.issuer.commune)}</CmnaOrigen>
        <CiudadOrigen>${escapeXml(input.issuer.city)}</CiudadOrigen>
      </Emisor>
      <Receptor>
        <RUTRecep>66666666-6</RUTRecep>
        <RznSocRecep>Consumidor Final</RznSocRecep>
      </Receptor>
${
  input.softwareProviderMode === "omit_for_certification_upload"
    ? ""
    : `      <RUTProvSW>${input.issuer.rut}</RUTProvSW>\n      <RznSocProvSW>${escapeXml(input.issuer.legalName)}</RznSocProvSW>`
}
      <Totales>
        <MntNeto>${totals.netAmount}</MntNeto>
        <IVA>${totals.taxAmount}</IVA>
        <MntTotal>${totals.totalAmount}</MntTotal>
      </Totales>
    </Encabezado>
${itemsXml}
    ${tedXml}
    <TmstFirma>${new Date().toISOString().slice(0, 19)}</TmstFirma>
  </Documento>
</DTE>`;

  const signedResult = signXmlInFinalContextControlled(
    {
      xml: unsignedXml,
      referenceId: documentId,
      insertAfterXPath: `//*[@ID='${documentId}']`,
    },
    {
      tenantId: input.tenantId,
      mode: "production",
      signatureTarget: `#${documentId}`,
      privateKeyPath: input.privateKeyPath,
      publicCertificatePath: input.certificatePath,
    },
  );

  const signedXml = signedResult.signedXml;
  const boletaXsdFullPath = resolve(repoRoot, BOLETA_XSD_PATH);
  validateXsd(signedXml, boletaXsdFullPath, "boleta-39-production", tmpdir());

  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(input.issuer.legalName, 36, 44);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.text(`RUT: ${input.issuer.rut}`, 36, 60);
  pdf.text(`Giro: ${input.issuer.businessActivity}`, 36, 74);
  pdf.text(`${input.issuer.address}, ${input.issuer.commune}, ${input.issuer.city}`, 36, 88);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("BOLETA ELECTRÓNICA", 390, 44);
  pdf.text(`N° ${input.folio}`, 390, 60);
  pdf.setFontSize(9);
  pdf.text(`Fecha: ${input.issueDate}`, 390, 76);
  pdf.text(`Res. N° ${input.issuer.resolutionNumber} del ${input.issuer.resolutionDate}`, 390, 90);

  pdf.setLineWidth(1);
  pdf.line(36, 110, 576, 110);

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.text("Receptor:", 36, 126);
  pdf.setFont("helvetica", "normal");
  pdf.text("Consumidor Final", 90, 126);

  pdf.line(36, 140, 576, 140);
  pdf.setFont("helvetica", "bold");
  pdf.text("Detalle", 36, 156);
  pdf.text("Cant.", 330, 156);
  pdf.text("Precio Unit.", 390, 156);
  pdf.text("Total", 490, 156);
  pdf.line(36, 164, 576, 164);

  pdf.setFont("helvetica", "normal");
  let y = 180;
  for (const line of input.lines) {
    pdf.text(line.description, 36, y);
    pdf.text(String(line.quantity), 330, y);
    pdf.text(`$${line.unitGrossAmount.toLocaleString("es-CL")}`, 390, y);
    pdf.text(`$${(line.quantity * line.unitGrossAmount).toLocaleString("es-CL")}`, 490, y);
    y += 18;
  }

  y = Math.max(y + 20, 260);
  pdf.line(36, y, 576, y);
  y += 18;
  pdf.text(`Neto: $${totals.netAmount.toLocaleString("es-CL")}`, 390, y);
  pdf.text(`IVA (19%): $${totals.taxAmount.toLocaleString("es-CL")}`, 390, y + 16);
  pdf.setFont("helvetica", "bold");
  pdf.text(`Total: $${totals.totalAmount.toLocaleString("es-CL")}`, 390, y + 34);

  const verificationUrl =
    input.publicVerificationUrl ?? "https://app.citaya.online/verificar/boleta";
  pdf.addImage(tedPng, "PNG", 80, 500, 250, 80);
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.text("Timbre Electrónico SII", 80, 594);
  pdf.text("Verifique en www.sii.cl", 80, 608);
  pdf.text(`Consulta Citaya: ${verificationUrl}`, 80, 622);

  const pdfArrayBuffer = pdf.output("arraybuffer");
  const pdfBytes = Buffer.from(pdfArrayBuffer);

  return {
    documentId,
    dteXml: signedXml,
    pdfBytes,
    sha256Xml: sha256Hex(signedXml),
    sha256Pdf: sha256Hex(pdfBytes),
    totals,
  };
}
