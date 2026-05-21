import { escapeXml } from "../xml/escape-xml";
import type { TedBuildResult, TedInput } from "../types";

function truncateTedText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function buildTedControlled(input: TedInput): TedBuildResult {
  const timestamp = (input.timestamp ?? new Date().toISOString()).slice(0, 19);
  const frmtXml =
    input.frmtXml ??
    '<FRMT algoritmo="SHA1withRSA">PENDIENTE-FIRMA-FRMT-CAF-REAL</FRMT>';
  const frmtStatus =
    input.frmtStatus ??
    (input.frmtXml ? "real_controlled" : "pending_real_signature");
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
      `  ${frmtXml}`,
      "</TED>",
    ].join("\n"),
    frmtStatus,
    warnings: [
      frmtStatus === "synthetic_lab"
        ? "TED sintetico LAB solo para validar estructura XSD; FRMT no es real."
        : frmtStatus === "real_controlled"
          ? "TED con FRMT generado desde clave CAF externa en modo certification controlado; no implica aprobacion SII."
          : "TED controlado no productivo: FRMT real pendiente.",
      frmtStatus === "real_controlled"
        ? "Requiere validar XML completo contra XSD oficial y ambiente SII certification."
        : "Requiere firmar DD con clave privada asociada al CAF y validar contra XSD oficial.",
    ],
    isProductionValid: false,
  };
}
