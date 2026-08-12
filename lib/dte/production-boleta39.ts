import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createVerify,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { jsPDF } from "jspdf";

import {
  BOLETA_XSD_PATH,
  boletaEnvelopeUnsigned,
  renderTedBarcodePng,
  validateXsd,
} from "./certification/boleta-pre-caf";
import { calculateBoletaGrossTotals } from "./boleta-money";
import { signFrmtControlled } from "./caf/frmt-signature";
import { buildOfficialFrmtDd, buildTedControlled } from "./caf/ted-builder";
import { formatRutWithDots, normalizeRut } from "./rut";
import { signXmlInFinalContextControlled } from "./signing/sign-xml.real";

export type ProductionBoleta39Issuer = {
  rut: string;
  senderRut?: string;
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
  recipient?: {
    rut?: string;
    legalName?: string;
    address?: string;
    commune?: string;
    city?: string;
  };
  lines: ProductionBoleta39Line[];
  cafXml: string;
  cafPrivateKeyPem?: string;
  cafPublicKeyPem?: string;
  privateKeyPath: string;
  certificatePath: string;
  generationTimestamp?: string;
  publicVerificationUrl?: string;
  softwareProviderMode?: "self_software" | "omit_for_certification_upload";
};

export type ProductionBoleta39Result = {
  documentId: string;
  dteXml: string;
  envioXml: string;
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

function chileTimestamp(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(" ", "T");
}

function oneTag(xml: string, tag: string): string {
  const matches = [
    ...xml.matchAll(
      new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g"),
    ),
  ];
  if (matches.length !== 1) throw new Error(`DTE_CAF_${tag}_INVALID`);
  return matches[0][0];
}

function tagValue(xml: string, tag: string): string {
  const block = oneTag(xml, tag);
  const value = block.match(
    new RegExp(`^<${tag}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${tag}>$`),
  )?.[1];
  if (value === undefined) throw new Error(`DTE_CAF_${tag}_INVALID`);
  return value.trim();
}

function firstTagValue(xml: string, tag: string): string {
  const match = xml.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`),
  );
  if (!match) throw new Error(`DTE_XML_${tag}_MISSING`);
  return match[1].trim();
}

function pemFromCaf(value: string): string {
  return `${value.replace(/&#10;/g, "\n").replace(/&amp;/g, "&").trim()}\n`;
}

function resolveCafSigningMaterial(input: ProductionBoleta39Input): {
  cafXml: string;
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const cafXml = oneTag(input.cafXml, "CAF");
  const privateKeyPem =
    input.cafPrivateKeyPem?.trim()
      ? `${input.cafPrivateKeyPem.trim()}\n`
      : pemFromCaf(tagValue(input.cafXml, "RSASK"));
  const publicKeyPem =
    input.cafPublicKeyPem?.trim()
      ? `${input.cafPublicKeyPem.trim()}\n`
      : pemFromCaf(tagValue(input.cafXml, "RSAPUBK"));
  const derived = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: "spki",
    format: "der",
  });
  const supplied = createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der",
  });
  if (!derived.equals(supplied)) throw new Error("DTE_CAF_PRIVATE_KEY_MISMATCH");
  const rangeFrom = Number(tagValue(cafXml, "D"));
  const rangeTo = Number(tagValue(cafXml, "H"));
  if (
    normalizeRut(tagValue(cafXml, "RE")) !== normalizeRut(input.issuer.rut) ||
    Number(tagValue(cafXml, "TD")) !== 39 ||
    !Number.isSafeInteger(rangeFrom) ||
    !Number.isSafeInteger(rangeTo) ||
    input.folio < rangeFrom ||
    input.folio > rangeTo
  ) {
    throw new Error("DTE_CAF_COVERAGE_MISMATCH");
  }
  return { cafXml, privateKeyPem, publicKeyPem };
}

export function encodeBoleta39Iso88591(xml: string): Buffer {
  if ([...xml].some((character) => (character.codePointAt(0) ?? 0) > 0xff)) {
    throw new Error("DTE_BOLETA39_XML_OUTSIDE_ISO_8859_1");
  }
  return Buffer.from(xml, "latin1");
}

export function verifyBoleta39XmlReference(input: {
  xmlBytes: Buffer;
  referenceId: string;
  certificatePath: string;
}): boolean {
  const root = mkdtempSync(join(tmpdir(), "citaya-boleta39-xmlsec-"));
  const path = join(root, "signed.xml");
  try {
    writeFileSync(path, input.xmlBytes, { mode: 0o600 });
    return (
      spawnSync(
        "xmlsec1",
        [
          "--verify",
          "--id-attr:ID",
          "Documento",
          "--id-attr:ID",
          "SetDTE",
          "--pubkey-cert-pem",
          input.certificatePath,
          "--node-xpath",
          `//*[local-name()='Signature'][.//*[local-name()='Reference' and @URI='#${input.referenceId}']]`,
          path,
        ],
        { stdio: "ignore" },
      ).status === 0
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function verifyBoleta39Ted(input: {
  dteXml: string;
  cafXml: string;
  cafPublicKeyPem: string;
  issuerRut: string;
  folio: number;
  issueDate: string;
  totalAmount: number;
}): boolean {
  try {
    const tedXml = oneTag(input.dteXml, "TED");
    const ddXml = oneTag(tedXml, "DD");
    const frmt = tagValue(tedXml, "FRMT").replace(/\s+/g, "");
    const embeddedCaf = oneTag(ddXml, "CAF");
    const rangeFrom = Number(tagValue(embeddedCaf, "D"));
    const rangeTo = Number(tagValue(embeddedCaf, "H"));
    if (
      buildOfficialFrmtDd(embeddedCaf) !==
        buildOfficialFrmtDd(input.cafXml) ||
      normalizeRut(firstTagValue(ddXml, "RE")) !==
        normalizeRut(input.issuerRut) ||
      Number(firstTagValue(ddXml, "TD")) !== 39 ||
      Number(firstTagValue(ddXml, "F")) !== input.folio ||
      firstTagValue(ddXml, "FE") !== input.issueDate ||
      normalizeRut(firstTagValue(ddXml, "RR")) !== "66666666-6" ||
      Number(firstTagValue(ddXml, "MNT")) !== input.totalAmount ||
      input.folio < rangeFrom ||
      input.folio > rangeTo
    ) {
      return false;
    }
    const verifier = createVerify("RSA-SHA1");
    verifier.update(Buffer.from(buildOfficialFrmtDd(ddXml), "latin1"));
    return verifier.verify(input.cafPublicKeyPem, frmt, "base64");
  } catch {
    return false;
  }
}

export async function buildProductionBoleta39Document(
  input: ProductionBoleta39Input,
): Promise<ProductionBoleta39Result> {
  const repoRoot = resolve(process.cwd());
  const documentId = `CitayaBoleta39-${input.folio}`;
  const totals = calculateBoletaGrossTotals(input.lines);
  const timestamp =
    input.generationTimestamp ?? chileTimestamp();

  // --- Blocking Monetary Validations ---
  const lineGrossSum = input.lines.reduce(
    (sum, line) => sum + line.quantity * line.unitGrossAmount,
    0,
  );
  if (
    lineGrossSum !== totals.totalAmount ||
    totals.netAmount + totals.taxAmount !== totals.totalAmount
  ) {
    throw new Error("DTE_MONETARY_SNAPSHOT_MISMATCH");
  }

  const caf = resolveCafSigningMaterial(input);
  const pendingTed = buildTedControlled({
    issuerRut: normalizeRut(input.issuer.rut),
    documentTypeCode: 39,
    folio: input.folio,
    issueDate: input.issueDate,
    recipientRut: "66666666-6",
    recipientLegalName: "Consumidor Final",
    totalAmount: totals.totalAmount,
    firstItemName: input.lines[0]?.description ?? "Servicios",
    cafXml: caf.cafXml,
    timestamp,
    compact: true,
  });
  const frmt = signFrmtControlled({
    ddXml: pendingTed.ddXml,
    privateKeyPem: caf.privateKeyPem,
    mode: "production",
  });
  if (!frmt.ok) throw new Error("DTE_BOLETA39_TED_FRMT_SIGN_FAILED");
  const tedXml = buildTedControlled({
    issuerRut: normalizeRut(input.issuer.rut),
    documentTypeCode: 39,
    folio: input.folio,
    issueDate: input.issueDate,
    recipientRut: "66666666-6",
    recipientLegalName: "Consumidor Final",
    totalAmount: totals.totalAmount,
    firstItemName: input.lines[0]?.description ?? "Servicios",
    cafXml: caf.cafXml,
    timestamp,
    compact: true,
    frmtXml: frmt.frmtXml,
    frmtStatus: "real_controlled",
  }).tedXml;
  if (!verifyBoleta39Ted({
    dteXml: tedXml,
    cafXml: caf.cafXml,
    cafPublicKeyPem: caf.publicKeyPem,
    issuerRut: input.issuer.rut,
    folio: input.folio,
    issueDate: input.issueDate,
    totalAmount: totals.totalAmount,
  })) {
    throw new Error("DTE_BOLETA39_TED_FRMT_VERIFY_FAILED");
  }

  const tedPng = await renderTedBarcodePng({ tedXml });

  const itemsXml = input.lines
    .map((line, index) => {
      const lineTotals = totals.lines[index];
      return `    <Detalle>
      <NroLinDet>${index + 1}</NroLinDet>
      <NmbItem>${escapeXml(line.description)}</NmbItem>
      <QtyItem>${line.quantity}</QtyItem>
      <PrcItem>${line.unitGrossAmount}</PrcItem>
      <MontoItem>${lineTotals.totalAmount}</MontoItem>
    </Detalle>`;
    })
    .join("\n");

  const unsignedXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0" xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Documento ID="${documentId}">
    <Encabezado>
      <IdDoc>
        <TipoDTE>39</TipoDTE>
        <Folio>${input.folio}</Folio>
        <FchEmis>${input.issueDate}</FchEmis>
        <IndServicio>3</IndServicio>
      </IdDoc>
      <Emisor>
        <RUTEmisor>${escapeXml(normalizeRut(input.issuer.rut))}</RUTEmisor>
        <RznSocEmisor>${escapeXml(input.issuer.legalName)}</RznSocEmisor>
        <GiroEmisor>${escapeXml(input.issuer.businessActivity)}</GiroEmisor>
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
    : `      <RUTProvSW>${normalizeRut(input.issuer.rut)}</RUTProvSW>\n      <RznSocProvSW>${escapeXml(input.issuer.legalName)}</RznSocProvSW>`
}
      <Totales>
        <MntNeto>${totals.netAmount}</MntNeto>
        <IVA>${totals.taxAmount}</IVA>
        <MntTotal>${totals.totalAmount}</MntTotal>
      </Totales>
    </Encabezado>
${itemsXml}
    ${tedXml}
    <TmstFirma>${timestamp}</TmstFirma>
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
      certificatePath: input.certificatePath,
    },
  );

  const signedXml = signedResult.signedXml;
  if (!verifyBoleta39XmlReference({
    xmlBytes: encodeBoleta39Iso88591(signedXml),
    referenceId: documentId,
    certificatePath: input.certificatePath,
  })) {
    throw new Error("DTE_BOLETA39_DOCUMENT_SIGNATURE_INVALID");
  }

  const envelope = boletaEnvelopeUnsigned({
    documents: [{ folio: input.folio, dteXml: signedXml }],
    issuer: {
      rut: input.issuer.rut,
      senderRut: input.issuer.senderRut,
      resolutionDate: input.issuer.resolutionDate,
      resolutionNumber: input.issuer.resolutionNumber,
    },
    timestamp,
  });
  if (!verifyBoleta39XmlReference({
    xmlBytes: encodeBoleta39Iso88591(envelope.xml),
    referenceId: documentId,
    certificatePath: input.certificatePath,
  })) {
    throw new Error("DTE_BOLETA39_DOCUMENT_FINAL_CONTEXT_INVALID");
  }

  const signedEnvelopeResult = signXmlInFinalContextControlled(
    {
      xml: envelope.xml,
      referenceId: envelope.setId,
      insertAfterXPath: "//*[local-name()='SetDTE']",
    },
    {
      tenantId: input.tenantId,
      mode: "production",
      signatureTarget: `#${envelope.setId}`,
      privateKeyPath: input.privateKeyPath,
      publicCertificatePath: input.certificatePath,
      certificatePath: input.certificatePath,
    },
  );

  const finalEnvelopeBytes = encodeBoleta39Iso88591(
    signedEnvelopeResult.signedXml,
  );
  for (const referenceId of [documentId, envelope.setId]) {
    if (!verifyBoleta39XmlReference({
      xmlBytes: finalEnvelopeBytes,
      referenceId,
      certificatePath: input.certificatePath,
    })) {
      throw new Error(`DTE_BOLETA39_SIGNATURE_${referenceId}_INVALID`);
    }
  }
  if (!verifyBoleta39Ted({
    dteXml: signedEnvelopeResult.signedXml,
    cafXml: caf.cafXml,
    cafPublicKeyPem: caf.publicKeyPem,
    issuerRut: input.issuer.rut,
    folio: input.folio,
    issueDate: input.issueDate,
    totalAmount: totals.totalAmount,
  })) {
    throw new Error("DTE_BOLETA39_TED_FINAL_BYTES_INVALID");
  }

  const boletaXsdFullPath = resolve(repoRoot, BOLETA_XSD_PATH);
  validateXsd(signedEnvelopeResult.signedXml, boletaXsdFullPath, "boleta-39-production", tmpdir());

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

  const recipientName = input.recipient?.legalName?.trim();
  const hasValidRecipientName = Boolean(recipientName && recipientName.toLowerCase() !== "consumidor final");

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.text("Cliente:", 36, 126);
  pdf.setFont("helvetica", "normal");
  if (hasValidRecipientName) {
    pdf.text(recipientName!, 90, 126);
    if (input.recipient?.rut && input.recipient.rut.trim() !== "66666666-6") {
      pdf.setFontSize(8);
      const formattedRut = formatRutWithDots(input.recipient.rut.trim());
      pdf.text(`RUT: ${formattedRut}`, 90, 136);
      pdf.text("Tipo de comprador: Consumidor final", 90, 146);
    } else {
      pdf.setFontSize(8);
      pdf.text("Tipo de comprador: Consumidor final", 90, 136);
    }
  } else {
    pdf.text("Consumidor Final", 90, 126);
  }

  pdf.line(36, 154, 576, 154);
  pdf.setFont("helvetica", "bold");
  pdf.text("Detalle", 36, 170);
  pdf.text("Cant.", 330, 170);
  pdf.text("Precio Unit.", 390, 170);
  pdf.text("Total", 490, 170);
  pdf.line(36, 178, 576, 178);

  pdf.setFont("helvetica", "normal");
  let y = 194;
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
    envioXml: signedEnvelopeResult.signedXml,
    pdfBytes,
    sha256Xml: sha256Hex(encodeBoleta39Iso88591(signedXml)),
    sha256Pdf: sha256Hex(pdfBytes),
    totals,
  };
}
