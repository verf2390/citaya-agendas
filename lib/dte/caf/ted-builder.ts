import { escapeXml } from "../xml/escape-xml";
import type { TedBuildResult, TedInput } from "../types";

function truncateTedText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function buildTedControlled(input: TedInput): TedBuildResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const ddXml = [
    "<DD>",
    `  <RE>${escapeXml(input.issuerRut)}</RE>`,
    `  <TD>${input.documentTypeCode}</TD>`,
    `  <F>${input.folio}</F>`,
    `  <FE>${escapeXml(input.issueDate)}</FE>`,
    `  <RR>${escapeXml(input.recipientRut)}</RR>`,
    `  <RSR>${escapeXml(truncateTedText(input.recipientLegalName, 40))}</RSR>`,
    `  <MNT>${input.totalAmount}</MNT>`,
    `  <IT1>${escapeXml(truncateTedText(input.firstItemName, 40))}</IT1>`,
    input.cafXml.trim(),
    `  <TSTED>${escapeXml(timestamp)}</TSTED>`,
    "</DD>",
  ].join("\n");

  return {
    ddXml,
    tedXml: [
      '<TED version="1.0">',
      ddXml,
      '  <FRMT algoritmo="SHA1withRSA">PENDIENTE-FIRMA-FRMT-CAF-REAL</FRMT>',
      "</TED>",
    ].join("\n"),
    frmtStatus: "pending_real_signature",
    warnings: [
      "TED controlado no productivo: FRMT real pendiente.",
      "Requiere firmar DD con clave privada asociada al CAF y validar contra XSD oficial.",
    ],
    isProductionValid: false,
  };
}

