import { isBoletaType } from "../dte-types";
import type { DteGenerationError, DteGenerationResult, TaxDocumentDraft } from "../types";
import { buildDteEnvelopeXmlLab } from "./build-dte-envelope";

// LAB / NO PRODUCTIVO: builder de boletas para XML estilo SII de laboratorio.
export function buildBoletaXmlLab(
  draft: TaxDocumentDraft,
): DteGenerationResult | DteGenerationError {
  if (!isBoletaType(draft.documentType)) {
    return {
      ok: false,
      status: "error",
      error: "buildBoletaXmlLab only accepts boleta document types",
    };
  }

  return buildDteEnvelopeXmlLab(draft);
}

export function buildBoletaXml(
  draft: TaxDocumentDraft,
): DteGenerationResult | DteGenerationError {
  return buildBoletaXmlLab(draft);
}
