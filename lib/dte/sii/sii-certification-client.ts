import type {
  SiiClientConfig,
  SiiRejectReason,
  SiiSendResult,
  SiiTrackStatusResult,
} from "../types";

import type { DteOperationalStatus } from "../status/dte-status";

export const SII_CERTIFICATION_CLIENT_PENDING_REAL_INTEGRATION =
  "SII_CERTIFICATION_CLIENT_PENDING_REAL_INTEGRATION";

export type SiiCertificationSubmitInput = {
  signedEnvioDteXml: string;
  fileName: string;
  config: SiiClientConfig;
};

export type SiiParsedResponse = {
  trackId: string | null;
  status: "sent" | "processing" | "accepted" | "accepted_with_observations" | "rejected" | "unknown";
  rawCode?: string | null;
  message?: string | null;
};

function pendingError(): Error {
  return new Error(
    `${SII_CERTIFICATION_CLIENT_PENDING_REAL_INTEGRATION}: integrar seed/token/upload/status reales del ambiente certificacion SII antes de enviar documentos.`,
  );
}

function missingConfig(config: SiiClientConfig): SiiRejectReason[] {
  const errors: SiiRejectReason[] = [];
  if (!config.baseUrl) errors.push({ code: "missing_base_url", message: "Falta URL base SII" });
  if (!config.rutEmpresa) errors.push({ code: "missing_company_rut", message: "Falta RUT empresa SII" });
  if (!config.rutUsuario) errors.push({ code: "missing_user_rut", message: "Falta RUT usuario SII" });
  return errors;
}

export async function submitCertificationSet(
  input: SiiCertificationSubmitInput,
): Promise<SiiSendResult> {
  const errors = missingConfig(input.config);
  if (!input.signedEnvioDteXml.trim()) {
    errors.push({ code: "missing_signed_xml", message: "Falta EnvioDTE firmado" });
  }
  if (!input.fileName.trim()) {
    errors.push({ code: "missing_file_name", message: "Falta nombre de archivo" });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      environment: input.config.environment,
      trackId: null,
      status: "pending",
      errors,
      isProductionValid: false,
    };
  }

  throw pendingError();
}

export async function getSubmissionStatus(
  trackId: string,
  config: SiiClientConfig,
): Promise<SiiTrackStatusResult> {
  const errors = missingConfig(config);
  if (!trackId.trim()) {
    errors.push({ code: "missing_track_id", message: "Falta track_id" });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      environment: config.environment,
      trackId,
      siiStatus: "unknown",
      errors,
      checkedAt: new Date().toISOString(),
      isProductionValid: false,
    };
  }

  throw pendingError();
}

export function parseSiiResponse(rawResponse: unknown): SiiParsedResponse {
  if (!rawResponse || typeof rawResponse !== "object") {
    return { trackId: null, status: "unknown", message: "Respuesta SII vacia o no estructurada" };
  }

  const record = rawResponse as Record<string, unknown>;
  const rawCode = String(record.status ?? record.estado ?? record.code ?? "").trim();
  const trackId = String(record.trackId ?? record.track_id ?? record.TRACKID ?? "").trim();

  return {
    trackId: trackId || null,
    status: mapRawSiiStatus(rawCode),
    rawCode: rawCode || null,
    message: String(record.message ?? record.glosa ?? "").trim() || null,
  };
}

export function mapRawSiiStatus(
  status: string,
): SiiParsedResponse["status"] {
  const normalized = status.trim().toUpperCase();
  if (["EPR", "ACEPTADO", "ACCEPTED"].includes(normalized)) return "accepted";
  if (["EOK", "ACEPTADO_CON_REPAROS", "ACCEPTED_WITH_OBSERVATIONS"].includes(normalized)) {
    return "accepted_with_observations";
  }
  if (["RCH", "RECHAZADO", "REJECTED"].includes(normalized)) return "rejected";
  if (["REC", "SENT"].includes(normalized)) return "sent";
  if (["PDR", "PROCESSING", "PROCESANDO"].includes(normalized)) return "processing";
  return "unknown";
}

export function mapSiiStatusToInternalStatus(
  status: SiiParsedResponse["status"],
): DteOperationalStatus {
  if (status === "accepted") return "accepted";
  if (status === "accepted_with_observations") return "accepted_with_observations";
  if (status === "rejected") return "rejected";
  if (status === "sent" || status === "processing") return "submitted";
  return "failed";
}
