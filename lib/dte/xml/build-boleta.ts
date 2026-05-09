import { buildDteEnvelope } from "./build-dte-envelope";
import type { DteGenerationError, DteGenerationResult, TaxDocumentDraft } from "../types";

export function buildBoletaXml(
  draft: TaxDocumentDraft,
): DteGenerationResult | DteGenerationError {
  if (draft.documentType !== "boleta_afecta" && draft.documentType !== "boleta_exenta") {
    return {
      ok: false,
      status: "error",
      error: "buildBoletaXml only accepts boleta document types",
    };
  }

  return buildDteEnvelope(draft);
}

