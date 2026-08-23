import { createHash } from "node:crypto";

import {
  assertBoletaApiEnvironmentHosts,
  BOLETA_API_ENVIRONMENT_CONFIG,
  BOLETA_CERTIFICATION_USER_AGENT,
  type BoletaApiEnvironment,
  BOLETA_PRODUCTION_API_BASE,
  BOLETA_PRODUCTION_SUBMIT_URL,
  buildBoletaDocumentStatusUrl,
  classifyBoletaRestSubmitFailure,
  BoletaRestSubmitHttpError,
  requestBoletaRestSeed,
  requestBoletaRestDocumentStatus,
  requestBoletaRestStatus,
  requestBoletaRestSubmit,
  requestBoletaRestToken,
  signBoletaRestSeed,
  splitRut,
} from "../certification/boleta39-rest-api";
import type { ProductionRuntimeConfig } from "./config";
import type {
  IProductionSiiClient,
  ProductionSiiMilestone,
  ProductionStatusResult,
  ProductionUploadResult,
} from "./sii-client";
import { loadValidatedProductionSigningMaterial } from "./signing-material";

export { BOLETA_PRODUCTION_API_BASE, BOLETA_PRODUCTION_SUBMIT_URL };

export const BOLETA_SII_DEFAULT_USER_AGENT =
  "Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)";

export type SingleBoletaTrackStatus =
  | "accepted"
  | "accepted_with_observations"
  | "rejected"
  | "processing"
  | null;

type BoletaTrackStatistic = {
  tipo: number;
  informados: number;
  aceptados: number;
  rechazados: number;
  reparos: number;
};

type BoletaTrackRejectionDetail = {
  tipo: number;
  folio: number | null;
  status: string;
};

const BOLETA_PROCESSING_ENVELOPE_STATUSES = new Set([
  "REC",
  "PRD",
  "CRT",
  "FOK",
  "SOK",
]);

const BOLETA_REJECTED_ENVELOPE_STATUSES = new Set([
  "RCH",
  "RCO",
  "RFR",
  "RSC",
  "RCT",
  "RPT",
  // VOF means the SII could not find the submitted XML. In this exactly-once
  // flow that envelope cannot progress, so it is a terminal rejection rather
  // than a reason to upload or query the document again.
  "VOF",
]);

function normalizedBoletaStatus(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9_-]{1,32}$/.test(normalized) ? normalized : "";
}

function detailStatus(status: string): Exclude<
  SingleBoletaTrackStatus,
  "processing" | null
> | null {
  if (status === "DOK") return "accepted";
  if (status === "RPR") return "accepted_with_observations";
  if (status === "RCH") return "rejected";
  return null;
}

export function deriveSingleBoletaStatusFromTrack(input: {
  dteType: number;
  expectedFolio?: number | null;
  envelopeStatus: string | null | undefined;
  statistics: readonly BoletaTrackStatistic[];
  rejectionDetails?: readonly BoletaTrackRejectionDetail[];
}): SingleBoletaTrackStatus {
  const envelopeStatus = normalizedBoletaStatus(input.envelopeStatus);
  const matchingStatistics = input.statistics.filter(
    (statistic) => statistic.tipo === input.dteType,
  );

  // More than one aggregate for the same type cannot describe exactly one DTE.
  if (matchingStatistics.length > 1) return null;

  let statisticStatus: Exclude<
    SingleBoletaTrackStatus,
    "processing" | null
  > | null = null;
  const statistic = matchingStatistics[0];
  if (statistic) {
    const counters = [
      statistic.informados,
      statistic.aceptados,
      statistic.rechazados,
      statistic.reparos,
    ];
    if (
      !counters.every(
        (counter) =>
          Number.isSafeInteger(counter) && counter >= 0 && counter <= 1,
      ) ||
      statistic.informados !== 1
    ) {
      return null;
    }

    if (
      statistic.rechazados === 1 &&
      statistic.aceptados === 0 &&
      statistic.reparos === 0
    ) {
      statisticStatus = "rejected";
    } else if (
      statistic.reparos === 1 &&
      statistic.rechazados === 0
    ) {
      // SII responses can report a repaired document either separately from
      // accepted documents or as an accepted document carrying one repair.
      statisticStatus = "accepted_with_observations";
    } else if (
      statistic.aceptados === 1 &&
      statistic.rechazados === 0 &&
      statistic.reparos === 0
    ) {
      statisticStatus = "accepted";
    } else if (
      statistic.aceptados !== 0 ||
      statistic.rechazados !== 0 ||
      statistic.reparos !== 0
    ) {
      return null;
    }
  }

  const expectedFolio = input.expectedFolio ?? null;
  const matchingDetails = (input.rejectionDetails ?? []).filter(
    (detail) =>
      detail.tipo === input.dteType &&
      (expectedFolio === null || detail.folio === expectedFolio),
  );
  if (matchingDetails.length > 1) return null;
  const matchedDetailStatus = matchingDetails[0]
    ? detailStatus(normalizedBoletaStatus(matchingDetails[0].status))
    : null;

  const envelopeTerminalStatus:
    | Exclude<SingleBoletaTrackStatus, "processing" | null>
    | null = envelopeStatus === "RPR"
      ? "accepted_with_observations"
      : BOLETA_REJECTED_ENVELOPE_STATUSES.has(envelopeStatus)
        ? "rejected"
        : null;
  const terminalEvidence = [
    statisticStatus,
    matchedDetailStatus,
    envelopeTerminalStatus,
  ].filter((status): status is Exclude<
    SingleBoletaTrackStatus,
    "processing" | null
  > => status !== null);
  const distinctTerminalEvidence = new Set(terminalEvidence);
  if (distinctTerminalEvidence.size > 1) return null;
  if (terminalEvidence[0]) return terminalEvidence[0];

  if (envelopeStatus === "EPR") {
    return "processing";
  }
  if (BOLETA_PROCESSING_ENVELOPE_STATUSES.has(envelopeStatus)) {
    return "processing";
  }
  return null;
}

export function resolveBoletaSiiUploadUserAgent(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return String(env.BOLETA_SII_USER_AGENT ?? "").trim() ||
    BOLETA_SII_DEFAULT_USER_AGENT;
}

export class SiiBoletaApiTransport implements IProductionSiiClient {
  constructor(
    private readonly config: ProductionRuntimeConfig,
    private readonly environment: BoletaApiEnvironment = "production",
    private readonly fetchImpl?: typeof fetch,
  ) {
    assertBoletaApiEnvironmentHosts(this.environment);
  }

  async uploadExactlyOnce(input: {
    envelope: Buffer;
    fileName: string;
    issuerRut: string;
    senderRut: string;
    certificatePath: string;
    privateKeyPath: string;
    milestone: (event: ProductionSiiMilestone) => Promise<void>;
  }): Promise<ProductionUploadResult> {
    const signingMaterial = loadValidatedProductionSigningMaterial({
      certificatePath: input.certificatePath,
      privateKeyPath: input.privateKeyPath,
      config: this.config,
    });

    let uploadStarted = false;
    let uploadCount = 0;

    try {
      const endpoints =
        BOLETA_API_ENVIRONMENT_CONFIG[this.environment];
      await input.milestone("seed_before_fetch");
      const seedResult = await requestBoletaRestSeed({
        environment: this.environment,
        seedUrl: `${endpoints.authBaseUrl}/boleta.electronica.semilla`,
        timeoutMs: this.config.timeoutMs,
      });
      await input.milestone("seed_after_fetch");

      if (seedResult.data.estado !== "00" || !seedResult.data.seed) {
        throw new Error(`BOLETA_API_SEED_REJECTED: ${seedResult.data.glosa ?? "No seed"}`);
      }

      const signedSeed = signBoletaRestSeed(
        seedResult.data.seed,
        signingMaterial.privateKeyPem,
        signingMaterial.certificatePem,
      );

      await input.milestone("token_before_fetch");
      const tokenResult = await requestBoletaRestToken(signedSeed.signedXml, {
        environment: this.environment,
        tokenUrl: `${endpoints.authBaseUrl}/boleta.electronica.token`,
        timeoutMs: this.config.timeoutMs,
      });
      await input.milestone("token_after_fetch");

      if (tokenResult.data.estado !== "00" || !tokenResult.data.token) {
        throw new Error(`BOLETA_API_TOKEN_REJECTED: ${tokenResult.data.glosa ?? "No token"}`);
      }

      await input.milestone("upload_before_fetch");
      uploadStarted = true;
      uploadCount += 1;
      if (uploadCount !== 1) {
        throw new Error("DTE_MULTIPLE_UPLOAD_BLOCKED");
      }

      const submitResult = await requestBoletaRestSubmit({
        environment: this.environment,
        token: tokenResult.data.token,
        senderRut: input.senderRut,
        companyRut: input.issuerRut,
        fileName: input.fileName,
        fileBytes: Uint8Array.from(input.envelope),
        submitUrl: `${endpoints.uploadBaseUrl}/boleta.electronica.envio`,
        timeoutMs: this.config.timeoutMs,
        userAgent: resolveBoletaSiiUploadUserAgent(),
      });
      await input.milestone("upload_after_fetch");

      const trackId = submitResult.data.trackId ? String(submitResult.data.trackId) : null;
      const isAccepted = submitResult.data.status === "REC" && Boolean(trackId);

      if (isAccepted && trackId) {
        return {
          status: "submitted",
          trackId,
          responseSha256: submitResult.responseSha256,
          responseSafe: {
            httpStatus: submitResult.httpStatus,
            contentType: submitResult.contentType,
            bytes: submitResult.responseBytes,
            category: "sii_accepted",
            siiStatus: submitResult.data.status,
          },
          // Persist the exact bytes whose digest was returned. Re-serializing
          // the response changes its digest and leaves a valid REC in SUBMITTING.
          responseBytes: Buffer.from(submitResult.responseBody, "utf8"),
          uploadCount: 1,
        };
      }

      return {
        status: "rejected",
        trackId: null,
        responseSha256: submitResult.responseSha256,
        responseSafe: {
          httpStatus: submitResult.httpStatus,
          contentType: submitResult.contentType,
          bytes: submitResult.responseBytes,
          category: "explicit_sii_rejection",
          siiStatus: submitResult.data.status,
        },
        responseBytes: Buffer.from(submitResult.responseBody, "utf8"),
        uploadCount: 1,
      };
    } catch (error) {
      if (!uploadStarted) throw error;
      const failureCategory = classifyBoletaRestSubmitFailure(error);
      const httpError =
        error instanceof BoletaRestSubmitHttpError
          ? error
          : null;
      const responseSafe = {
        category:
          failureCategory === "AUTH_FAILURE"
            ? "auth_failure"
            : failureCategory === "HTTP_FAILURE"
              ? "http_failure"
              : "network_or_timeout",
        reason: error instanceof Error ? error.message : "UNKNOWN_UPLOAD_ERROR",
        ...(httpError
          ? {
              httpStatus: httpError.status,
              contentType: httpError.contentType,
              bytes: httpError.responseBytes,
              siiResponse: httpError.responseText,
              responseHeaderNames: httpError.responseHeaderNames,
              wwwAuthenticate: httpError.wwwAuthenticate,
              host: httpError.host,
              timestamp: httpError.timestamp,
              requestId: httpError.requestId,
              correlationId: httpError.correlationId,
            }
          : {}),
      };

      if (failureCategory === "NETWORK_OR_TIMEOUT") {
        return {
          status: "ambiguous",
          trackId: null,
          responseSha256: null,
          responseSafe,
          responseBytes: null,
          uploadCount: 1,
        };
      }

      return {
        status: "rejected",
        trackId: null,
        responseSha256: createHash("sha256")
          .update(Buffer.from(httpError?.responseText ?? "", "utf8"))
          .digest("hex"),
        responseSafe,
        responseBytes: null,
        uploadCount: 1,
      };
    }
  }

  async queryStatusManually(input: {
    trackId: string;
    token: string;
    milestone: (event: ProductionSiiMilestone) => Promise<void>;
    companyRut?: string;
    document?: {
      dteType: 39 | 41;
      folio: number;
      recipientRut: string;
      amount: number;
      issueDate: string;
    };
  }): Promise<ProductionStatusResult> {
    const endpoints =
      BOLETA_API_ENVIRONMENT_CONFIG[this.environment];
    await input.milestone("status_before_fetch");
    const statusResult = await requestBoletaRestStatus({
      environment: this.environment,
      token: input.token,
      companyRut: input.companyRut ?? "78195645-7",
      trackId: input.trackId,
      apiBaseUrl: endpoints.queryBaseUrl,
      timeoutMs: this.config.timeoutMs,
      userAgent: resolveBoletaSiiUploadUserAgent(),
      fetchImpl: this.fetchImpl,
    });
    const singleBoleta39 = input.document?.dteType === 39
      ? input.document
      : null;
    const trackStatus = singleBoleta39
      ? deriveSingleBoletaStatusFromTrack({
          dteType: singleBoleta39.dteType,
          expectedFolio: singleBoleta39.folio,
          envelopeStatus: statusResult.data.status,
          statistics: statusResult.data.estadisticas,
          rejectionDetails: statusResult.data.detalleRepRech,
        })
      : null;
    const safeTrackResponse = {
      category: "boleta_track_status",
      source: "track_id",
      httpStatus: statusResult.httpStatus,
      contentType: statusResult.contentType.slice(0, 80),
      bytes: statusResult.responseBytes,
      envelopeStatus:
        normalizedBoletaStatus(statusResult.data.status) || "UNKNOWN",
      statistics: statusResult.data.estadisticas
        .filter((statistic) => statistic.tipo === input.document?.dteType)
        .map((statistic) => ({ ...statistic })),
      rejectionDetailCount: statusResult.data.detalleRepRech.length,
      derivedStatus: trackStatus ?? "processing",
      derivationConclusive: trackStatus !== null && trackStatus !== "processing",
    };

    if (singleBoleta39) {
      await input.milestone("status_after_fetch");
      return {
        trackId: input.trackId,
        siiStatus: trackStatus ?? "processing",
        responseSha256: statusResult.responseSha256,
        responseBytes: Buffer.from(JSON.stringify(safeTrackResponse), "utf8"),
        responseSafe: safeTrackResponse,
      };
    }

    const documentResult = input.document
      ? await requestBoletaRestDocumentStatus({
          environment: this.environment,
          token: input.token,
          companyRut: input.companyRut ?? "78195645-7",
          dteType: input.document.dteType,
          folio: input.document.folio,
          recipientRut: input.document.recipientRut,
          amount: input.document.amount,
          issueDate: input.document.issueDate,
          timeoutMs: this.config.timeoutMs,
          userAgent: resolveBoletaSiiUploadUserAgent(),
          fetchImpl: this.fetchImpl,
        })
      : null;
    await input.milestone("status_after_fetch");

    const documentCode = String(documentResult?.data.code ?? "").toUpperCase();
    const siiStatus = ["DOK", "RCH"].includes(documentCode)
      ? documentCode
      : statusResult.data.status;
    const responseSafe = documentResult
      ? {
          track: safeTrackResponse,
          document: {
            category: "boleta_document_status",
            httpStatus: documentResult.httpStatus,
            contentType: documentResult.contentType.slice(0, 80),
            bytes: documentResult.responseBytes,
            code: documentCode.slice(0, 32),
          },
        }
      : safeTrackResponse;

    return {
      trackId: input.trackId,
      siiStatus,
      responseSha256: documentResult?.responseSha256 ?? statusResult.responseSha256,
      responseBytes: Buffer.from(JSON.stringify(responseSafe), "utf8"),
      responseSafe,
    };
  }

  async queryTrackStatus(companyRut: string, trackId: string, token: string) {
    const company = splitRut(companyRut);
    if (!company) throw new Error("BOLETA_API_RUT_INVALID");
    const queryBaseUrl =
      BOLETA_API_ENVIRONMENT_CONFIG[this.environment].queryBaseUrl;
    const url = `${queryBaseUrl}/boleta.electronica.envio/${company.rut}-${company.dv}-${trackId}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Cookie: `TOKEN=${token}`,
        "User-Agent": BOLETA_CERTIFICATION_USER_AGENT,
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    const isJson = contentType.toLowerCase().includes("application/json");
    const isRejectedHtml = text.includes("Transaccion Rechazada");

    if (!isJson || isRejectedHtml) {
      return {
        querySuccess: false,
        queryError: "SII_QUERY_TRANSACTION_REJECTED",
        httpStatus: res.status,
        contentType,
        rawText: text,
      };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawText: text };
    }
    return { querySuccess: true, status: res.status, data, rawText: text };
  }

  async queryBoletaStatus(
    companyRut: string,
    folio: number,
    token: string,
    params?: {
      rutReceptor?: string;
      dvReceptor?: string;
      monto?: number;
      fechaEmision?: string;
    },
  ) {
    if (
      !params?.rutReceptor ||
      params.monto === undefined ||
      !params.fechaEmision
    ) {
      throw new Error("BOLETA_API_DOCUMENT_QUERY_PARAMETERS_REQUIRED");
    }
    const recipientRut = params.rutReceptor.includes("-")
      ? params.rutReceptor
      : `${params.rutReceptor}-${params.dvReceptor ?? ""}`;
    const queryBaseUrl =
      BOLETA_API_ENVIRONMENT_CONFIG[this.environment].queryBaseUrl;
    const url = buildBoletaDocumentStatusUrl({
      environment: this.environment,
      companyRut,
      dteType: 39,
      folio,
      recipientRut,
      amount: params.monto,
      issueDate: params.fechaEmision,
      queryBaseUrl,
    });
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Cookie: `TOKEN=${token}`,
        "User-Agent": BOLETA_CERTIFICATION_USER_AGENT,
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    const isJson = contentType.toLowerCase().includes("application/json");
    const isRejectedHtml = text.includes("Transaccion Rechazada");

    if (!isJson || isRejectedHtml) {
      return {
        querySuccess: false,
        queryError: "SII_QUERY_TRANSACTION_REJECTED",
        httpStatus: res.status,
        contentType,
        rawText: text,
      };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawText: text };
    }
    return { querySuccess: true, status: res.status, data, rawText: text };
  }
}
