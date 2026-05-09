import { isSupportedDteDocumentType } from "../dte-types";
import { validateRut } from "../rut";
import type { TaxDocumentDraft, TaxDocumentLine } from "../types";

function assertFiniteNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
}

function assertNonNegativeNumber(value: number, fieldName: string): void {
  assertFiniteNumber(value, fieldName);

  if (value < 0) {
    throw new Error(`${fieldName} must be greater than or equal to zero`);
  }
}

function validateLine(line: TaxDocumentLine, index: number): void {
  const prefix = `details[${index}]`;

  if (!line.name.trim()) {
    throw new Error(`${prefix}.name is required`);
  }

  assertFiniteNumber(line.quantity, `${prefix}.quantity`);
  if (line.quantity <= 0) {
    throw new Error(`${prefix}.quantity must be greater than zero`);
  }

  assertNonNegativeNumber(line.unitPrice, `${prefix}.unitPrice`);
  assertNonNegativeNumber(line.amount, `${prefix}.amount`);
}

// LAB / NO PRODUCTIVO: validaciones mínimas antes de generar XML estilo SII.
export function validateDteDraftForXmlLab(draft: TaxDocumentDraft): void {
  if (!validateRut(draft.issuer.rut)) {
    throw new Error("Issuer RUT is invalid");
  }

  if (!validateRut(draft.recipient.rut)) {
    throw new Error("Recipient RUT is invalid");
  }

  if (!isSupportedDteDocumentType(draft.documentType)) {
    throw new Error(`Unsupported DTE type: ${draft.documentType}`);
  }

  assertFiniteNumber(draft.folio, "folio");
  if (draft.folio <= 0) {
    throw new Error("folio must be greater than zero");
  }

  if (!draft.issueDate.trim()) {
    throw new Error("issueDate is required");
  }

  assertNonNegativeNumber(draft.netAmount ?? 0, "netAmount");
  assertNonNegativeNumber(draft.exemptAmount ?? 0, "exemptAmount");
  assertNonNegativeNumber(draft.taxAmount ?? 0, "taxAmount");
  assertNonNegativeNumber(draft.totalAmount, "totalAmount");

  if (draft.lines.length === 0) {
    throw new Error("At least one document detail is required");
  }

  draft.lines.forEach(validateLine);
}
