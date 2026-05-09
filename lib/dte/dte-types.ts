export type DteDocumentType =
  | "boleta_exenta"
  | "boleta_afecta"
  | "factura_exenta"
  | "factura_afecta"
  | "nota_credito"
  | "nota_debito";

export const SII_DTE_TYPE_CODES: Record<DteDocumentType, number> = {
  boleta_exenta: 41,
  boleta_afecta: 39,
  factura_exenta: 34,
  factura_afecta: 33,
  nota_credito: 61,
  nota_debito: 56,
};

export function isSupportedDteDocumentType(
  documentType: string,
): documentType is DteDocumentType {
  return Object.hasOwn(SII_DTE_TYPE_CODES, documentType);
}

export function getSiiDteTypeCode(documentType: DteDocumentType): number {
  return SII_DTE_TYPE_CODES[documentType];
}

export function isInvoiceType(documentType: DteDocumentType): boolean {
  return documentType === "factura_afecta" || documentType === "factura_exenta";
}

export function isBoletaType(documentType: DteDocumentType): boolean {
  return documentType === "boleta_afecta" || documentType === "boleta_exenta";
}
