import { isInvoiceType } from "../dte-types";
import type {
  DteEnvelopeBuildOptions,
  DteGenerationError,
  DteGenerationResult,
  TaxDocumentDraft,
} from "../types";
import { buildDteEnvelopeXmlLab } from "./build-dte-envelope";

// LAB / NO PRODUCTIVO: builder de facturas para XML estilo SII de laboratorio.
export function buildFacturaXmlLab(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  if (!isInvoiceType(draft.documentType)) {
    return {
      ok: false,
      status: "error",
      error: "buildFacturaXmlLab only accepts factura document types",
    };
  }

  return buildDteEnvelopeXmlLab(draft, options);
}

export function buildFacturaXml(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  return buildFacturaXmlLab(draft, options);
}
