import { DOMParser } from "@xmldom/xmldom";
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

function withTimeout(config: SiiCertificationConfig, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    signal: AbortSignal.timeout(config.timeoutMs || 30_000),
  };
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

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function xmlValue(raw: string, names: readonly string[]): string | null {
  for (const name of names) {
    const match = raw.match(
      new RegExp(
        `<(?:[A-Za-z0-9_-]+:)?${name}[^>]*>\\s*([^<]+)`,
        "i",
      ),
    );
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function integerXmlValue(raw: string, names: readonly string[]): number | null {
  const value = xmlValue(raw, names);
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

function parseRawResponse(rawResponse: unknown): Record<string, unknown> {
  if (!rawResponse) return {};
  if (typeof rawResponse === "object") return rawResponse as Record<string, unknown>;
  const raw = String(rawResponse).trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const decoded = decodeXmlEntities(raw);
    return {
      trackId: xmlValue(decoded, ["TRACKID", "TRACK_ID"]),
      status: xmlValue(decoded, ["ESTADO", "STATUS"]),
      message: xmlValue(decoded, ["GLOSA", "MESSAGE"]),
      informedCount: integerXmlValue(decoded, ["INFORMADOS", "INFORMADO"]),
      acceptedCount: integerXmlValue(decoded, ["ACEPTADOS", "ACEPTADO"]),
      rejectedCount: integerXmlValue(decoded, ["RECHAZADOS", "RECHAZADO"]),
      objectionCount: integerXmlValue(decoded, ["REPAROS", "REPARO"]),
      raw,
    };
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

export function safeUnknownSiiStatusCode(rawStatus: unknown): string {
  const token = String(rawStatus ?? "").trim().toUpperCase();
  if (
    !/^[A-Z0-9_-]{1,8}$/.test(token) ||
    /\d{5}/.test(token)
  ) {
    return "DTE_SII_STATUS_UNKNOWN";
  }
  return `DTE_SII_STATUS_UNKNOWN_${token}`;
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
  informedCount: number | null;
  acceptedCount: number | null;
  rejectedCount: number | null;
  objectionCount: number | null;
} {
  const record = parseRawResponse(rawResponse);
  const rawStatus = valueFromRecord(record, ["status", "estado", "code", "STATUS", "ESTADO"]);
  const status = mapRawSiiStatus(rawStatus);
  const trackId = valueFromRecord(record, ["trackId", "track_id", "TRACKID", "TRACK_ID"]);
  const message = valueFromRecord(record, ["message", "glosa", "GLOSA", "error"]);
  const count = (key: string) => {
    const value = record[key];
    return typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : null;
  };

  return {
    trackId: trackId || null,
    status,
    rawStatus: rawStatus || null,
    message: message || null,
    internalStatus: mapSiiStatusToInternalStatus(status),
    informedCount: count("informedCount"),
    acceptedCount: count("acceptedCount"),
    rejectedCount: count("rejectedCount"),
    objectionCount: count("objectionCount"),
  };
}

export function parseSiiStatusResponse(rawResponse: unknown): SiiParsedResponse & {
  internalStatus: DteOperationalStatus;
  informedCount: number | null;
  acceptedCount: number | null;
  rejectedCount: number | null;
  objectionCount: number | null;
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
  const response = await fetchImpl(url, withTimeout(config, {
    method: "GET",
    headers: { cookie: `TOKEN=${options.token}` },
  }));
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


export const SII_CERTIFICATION_QUERY_EST_DTE_URL = "https://maullin.sii.cl/DTEWS/QueryEstDte.jws";
export type SiiDteQueryInput = { rutConsultante: string; dvConsultante: string; rutCompania: string; dvCompania: string; rutReceptor: string; dvReceptor: string; tipoDte: "33"; folioDte: "1"; fechaEmisionDte: string; montoDte: string; };
export type SiiDteQueryResult = { estado: string | null; glosa: string | null; errCode: string | null; sqlCode: string | null; srvCode: string | null; numeroAtencionPresent: boolean; queryExecuted: boolean; siiContacted: true; };
function queryEscape(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
type QueryXmlNode = { localName?: string | null; nodeName?: string | null; textContent?: string | null; childNodes?: ArrayLike<unknown> };
function queryNodeText(node: unknown, name: string): string | null { if (!node || typeof node !== "object") return null; const xmlNode = node as QueryXmlNode; if (xmlNode.localName === name || xmlNode.nodeName === name) return String(xmlNode.textContent ?? "").trim() || null; for (const child of Array.from(xmlNode.childNodes ?? [])) { const value = queryNodeText(child, name); if (value) return value; } return null; }
function queryDocuments(raw: string): Array<ReturnType<DOMParser["parseFromString"]>> { const outer = new DOMParser().parseFromString(raw, "text/xml"); const documents = [outer]; for (const name of ["getEstDteReturn", "return"]) { const nested = queryNodeText(outer, name); if (nested && nested.includes("<")) documents.unshift(new DOMParser().parseFromString(nested, "text/xml")); } return documents; }
function queryField(documents: readonly unknown[], name: string): string | null { for (const document of documents) { const value = queryNodeText(document, name); if (value) return value; } return null; }
export function buildQueryEstDteSoapEnvelope(input: SiiDteQueryInput, token: string): string { const value = (name: string, content: string) => "<" + name + " xsi:type=\"xsd:string\">" + queryEscape(content) + "</" + name + ">"; return ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<SOAP-ENV:Envelope xmlns:SOAP-ENV=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:SOAP-ENC=\"http://schemas.xmlsoap.org/soap/encoding/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:m=\"http://DefaultNamespace\" SOAP-ENV:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">", "<SOAP-ENV:Body>", "<m:getEstDte>", value("RutConsultante", input.rutConsultante), value("DvConsultante", input.dvConsultante), value("RutCompania", input.rutCompania), value("DvCompania", input.dvCompania), value("RutReceptor", input.rutReceptor), value("DvReceptor", input.dvReceptor), value("TipoDte", input.tipoDte), value("FolioDte", input.folioDte), value("FechaEmisionDte", input.fechaEmisionDte), value("MontoDte", input.montoDte), value("Token", token), "</m:getEstDte>", "</SOAP-ENV:Body>", "</SOAP-ENV:Envelope>"].join(""); }
export function parseQueryEstDteResponse(raw: string): Omit<SiiDteQueryResult, "queryExecuted" | "siiContacted"> { const documents = queryDocuments(raw); const estado = queryField(documents, "ESTADO") ?? queryField(documents, "Estado"); const glosa = queryField(documents, "GLOSA") ?? queryField(documents, "Glosa"); const errCode = queryField(documents, "ERR_CODE"); const sqlCode = queryField(documents, "SQL_CODE"); const srvCode = queryField(documents, "SRV_CODE"); const numeroAtencionPresent = Boolean(queryField(documents, "NUM_ATENCION") ?? queryField(documents, "NUMERO_ATENCION")); return { estado, glosa, errCode, sqlCode, srvCode, numeroAtencionPresent }; }
export async function queryCertificationDteStatus(config: SiiCertificationConfig, input: SiiDteQueryInput, options: { token: string; fetchImpl?: typeof fetch } ): Promise<SiiDteQueryResult> { assertCertificationEnvironment(config.environment); if (config.statusUrl !== SII_CERTIFICATION_QUERY_EST_DTE_URL) throw new SiiCertificationError(SII_ERROR_CODES.INVALID_REQUEST, "Endpoint QueryEstDte de certificacion invalido.", "DTE_SII_STATUS_URL"); if (!options.token.trim()) throw new SiiCertificationError(SII_ERROR_CODES.INVALID_REQUEST, "Token SII requerido.", "token"); const response = await (options.fetchImpl ?? fetch)(config.statusUrl, withTimeout(config, { method: "POST", headers: { "content-type": "text/xml; charset=utf-8", soapaction: "" }, body: buildQueryEstDteSoapEnvelope(input, options.token) })); const raw = await response.text(); const parsed = parseQueryEstDteResponse(raw); if (!response.ok) throw new SiiCertificationError(SII_ERROR_CODES.INVALID_RESPONSE, "Respuesta QueryEstDte no exitosa.", "QueryEstDte"); return { ...parsed, queryExecuted: true, siiContacted: true }; }
