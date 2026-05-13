import { isBoletaType } from "../dte-types";
import type {
  DteEnvelopeBuildOptions,
  DteGenerationError,
  DteGenerationResult,
  TaxDocumentDraft,
} from "../types";
import { buildDteEnvelopeXmlLab } from "./build-dte-envelope";

// LAB / NO PRODUCTIVO: builder de boletas para XML estilo SII de laboratorio.
export function buildBoletaXmlLab(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  if (!isBoletaType(draft.documentType)) {
    return {
      ok: false,
      status: "error",
      error: "buildBoletaXmlLab only accepts boleta document types",
    };
  }

  return buildDteEnvelopeXmlLab(draft, options);
}

export function buildBoletaXml(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  return buildBoletaXmlLab(draft, options);
}
