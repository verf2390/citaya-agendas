import { buildDteEnvelope } from "./build-dte-envelope";
import type { DteGenerationError, DteGenerationResult, TaxDocumentDraft } from "../types";

export function buildFacturaXml(
  draft: TaxDocumentDraft,
): DteGenerationResult | DteGenerationError {
  if (draft.documentType !== "factura_afecta" && draft.documentType !== "factura_exenta") {
    return {
      ok: false,
      status: "error",
      error: "buildFacturaXml only accepts factura document types",
    };
  }

  return buildDteEnvelope(draft);
}

