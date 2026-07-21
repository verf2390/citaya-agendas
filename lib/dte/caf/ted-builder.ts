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
  const separator = input.compact ? "" : "\n";
  const indent = input.compact ? "" : "  ";
  const ddXml = [
    "<DD>",
    `${indent}<RE>${escapeXml(input.issuerRut)}</RE>`,
    `${indent}<TD>${input.documentTypeCode}</TD>`,
    `${indent}<F>${input.folio}</F>`,
    `${indent}<FE>${escapeXml(input.issueDate)}</FE>`,
    `${indent}<RR>${escapeXml(input.recipientRut)}</RR>`,
    `${indent}<RSR>${escapeXml(truncateTedText(input.recipientLegalName, 40))}</RSR>`,
    `${indent}<MNT>${input.totalAmount}</MNT>`,
    `${indent}<IT1>${escapeXml(truncateTedText(input.firstItemName, 40))}</IT1>`,
    input.cafXml.trim(),
    `${indent}<TSTED>${escapeXml(timestamp)}</TSTED>`,
    "</DD>",
  ].join(separator);

  return {
    ddXml,
    tedXml: [
      '<TED version="1.0">',
      ddXml,
      `${indent}${frmtXml}`,
      "</TED>",
    ].join(separator),
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
