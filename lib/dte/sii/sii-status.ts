import { SII_ERROR_CODES, SiiCertificationError, assertCertificationEnvironment } from "./sii-errors";
import type {
  SiiCertificationConfig,
  SiiCertificationStatus,
  SiiParsedResponse,
  SiiStatusCertificationResult,
} from "./sii-types";
import type { DteOperationalStatus } from "../status/dte-status";

function now(): string {
  return new Date().toISOString();
}

function valueFromRecord(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function parseRawResponse(rawResponse: unknown): Record<string, unknown> {
  if (!rawResponse) return {};
  if (typeof rawResponse === "object") return rawResponse as Record<string, unknown>;
  const raw = String(rawResponse).trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const track = raw.match(/<(?:TRACKID|TRACK_ID|trackId)[^>]*>([^<]+)</i)?.[1];
    const status = raw.match(/<(?:ESTADO|STATUS|estado|status)[^>]*>([^<]+)</i)?.[1];
    const message = raw.match(/<(?:GLOSA|MESSAGE|message)[^>]*>([^<]+)</i)?.[1];
    return { trackId: track, status, message, raw };
  }
}

export function mapRawSiiStatus(status: string): SiiCertificationStatus {
  const normalized = status.trim().toUpperCase();
  if (["EPR", "ACEPTADO", "ACCEPTED"].includes(normalized)) return "accepted";
  if (["EOK", "ACEPTADO_CON_REPAROS", "ACCEPTED_WITH_OBSERVATIONS"].includes(normalized)) {
    return "accepted_with_observations";
  }
  if (["RCH", "RECHAZADO", "REJECTED"].includes(normalized)) return "rejected";
  if (["REC", "SENT", "ENVIADO"].includes(normalized)) return "sent";
  if (["PDR", "PROCESSING", "PROCESANDO", "EN_PROCESO"].includes(normalized)) {
    return "processing";
  }
  if (["ERR", "ERROR", "FAILED"].includes(normalized)) return "failed";
  return "unknown";
}

export function mapSiiStatusToInternalStatus(
  status: SiiCertificationStatus,
): DteOperationalStatus {
  if (status === "accepted") return "accepted";
  if (status === "accepted_with_observations") return "accepted_with_observations";
  if (status === "rejected") return "rejected";
  if (status === "sent" || status === "processing") return "submitted";
  return "failed";
}

export function parseSiiSubmissionResponse(rawResponse: unknown): SiiParsedResponse & {
  internalStatus: DteOperationalStatus;
} {
  const record = parseRawResponse(rawResponse);
  const rawStatus = valueFromRecord(record, ["status", "estado", "code", "STATUS", "ESTADO"]);
  const status = mapRawSiiStatus(rawStatus);
  const trackId = valueFromRecord(record, ["trackId", "track_id", "TRACKID", "TRACK_ID"]);
  const message = valueFromRecord(record, ["message", "glosa", "GLOSA", "error"]);

  return {
    trackId: trackId || null,
    status,
    rawStatus: rawStatus || null,
    message: message || null,
    internalStatus: mapSiiStatusToInternalStatus(status),
  };
}

export function parseSiiStatusResponse(rawResponse: unknown): SiiParsedResponse & {
  internalStatus: DteOperationalStatus;
} {
  return parseSiiSubmissionResponse(rawResponse);
}

export async function getSubmissionStatus(
  config: SiiCertificationConfig,
  options: {
    trackId: string;
    token?: string | null;
    dryRun?: boolean;
    fetchImpl?: typeof fetch;
  },
): Promise<SiiStatusCertificationResult> {
  assertCertificationEnvironment(config.environment);
  if (!config.statusUrl.trim()) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.ENDPOINT_MISSING,
      "Falta endpoint status SII certification.",
      "DTE_SII_STATUS_URL",
    );
  }
  if (!options.trackId.trim()) {
    throw new SiiCertificationError(SII_ERROR_CODES.INVALID_REQUEST, "track_id requerido.", "trackId");
  }
  if (!options.token?.trim()) {
    throw new SiiCertificationError(SII_ERROR_CODES.INVALID_REQUEST, "Token SII requerido.", "token");
  }

  if (options.dryRun) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.STATUS_PENDING_REAL_CERTIFICATION,
      "Consulta status real bloqueada en dry-run.",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${config.statusUrl}${config.statusUrl.includes("?") ? "&" : "?"}trackId=${encodeURIComponent(options.trackId)}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { cookie: `TOKEN=${options.token}` },
  });
  const raw = await response.text();
  const parsed = parseSiiStatusResponse(raw);

  return {
    ok: response.ok && parsed.status !== "unknown" && parsed.status !== "failed",
    trackId: options.trackId,
    rawStatus: parsed.rawStatus,
    internalStatus: parsed.internalStatus,
    siiStatus: parsed.status,
    message: parsed.message ?? "Respuesta status SII recibida.",
    checkedAt: now(),
    environment: "certification",
  };
}
