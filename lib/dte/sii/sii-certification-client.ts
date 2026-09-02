import { existsSync, readFileSync } from "node:fs";
import { fingerprintToken } from "../persistence/dte-redaction";

import type {
  SiiClientConfig,
  SiiRejectReason,
  SiiSendResult,
  SiiTrackStatusResult,
} from "../types";
import {
  SII_ERROR_CODES,
  SiiCertificationError,
  toSiiCertificationError,
} from "./sii-errors";
import {
  SII_CERTIFICATION_SEED_URL,
  SII_CERTIFICATION_TOKEN_URL,
  requestSeed,
  requestToken,
  signSeed,
} from "./sii-auth";
import { submitCertificationSet as submitSet } from "./sii-submit";
import {
  getSubmissionStatus as getStatus,
  mapRawSiiStatus,
  mapSiiStatusToInternalStatus,
  parseSiiStatusResponse,
  parseSiiSubmissionResponse,
  queryCertificationDteStatus as queryDteStatus,
  type SiiDteQueryInput,
  type SiiDteQueryResult,
} from "./sii-status";
import type {
  SiiCertificationConfig,
  SiiParsedResponse,
  SiiSubmitCertificationResult,
} from "./sii-types";

export const SII_CERTIFICATION_CLIENT_PENDING_REAL_INTEGRATION =
  "SII_CERTIFICATION_CLIENT_PENDING_REAL_INTEGRATION";

export type SiiCertificationSubmitInput = {
  signedEnvioDteXml: string;
  fileName: string;
  config: SiiClientConfig | SiiCertificationConfig;
};

function envValue(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return String(env[name] ?? "").trim();
}

export function getSiiCertificationConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SiiCertificationConfig {
  const rawMode = envValue("DTE_MODE", env) || "lab";
  if (rawMode === "production") {
    throw new SiiCertificationError(
      SII_ERROR_CODES.PRODUCTION_DISABLED,
      "DTE_MODE=production bloqueado hasta aprobacion SII real y feature flag futuro.",
      "DTE_MODE",
    );
  }

  const rawEnvironment = envValue("DTE_SII_ENV", env) || "certification";
  if (rawEnvironment === "production") {
    throw new SiiCertificationError(
      SII_ERROR_CODES.PRODUCTION_DISABLED,
      "Production SII bloqueado hasta aprobacion real y feature flag futuro.",
      "DTE_SII_ENV",
    );
  }

  return {
    environment: "certification",
    seedUrl: envValue("DTE_SII_SEED_URL", env) || SII_CERTIFICATION_SEED_URL,
    tokenUrl: envValue("DTE_SII_TOKEN_URL", env) || SII_CERTIFICATION_TOKEN_URL,
    submitUrl: envValue("DTE_SII_SUBMIT_URL", env),
    statusUrl: envValue("DTE_SII_STATUS_URL", env),
    certPath: envValue("DTE_CERT_PATH", env) || null,
    privateKeyPath: envValue("DTE_PRIVATE_KEY_PATH", env) || null,
    cafPath: envValue("DTE_CAF_PATH", env) || null,
    cafPrivateKeyPath: envValue("DTE_CAF_PRIVATE_KEY_PATH", env) || null,
    rutEmpresa: envValue("SII_RUT_EMPRESA", env) || envValue("DTE_ISSUER_RUT", env) || null,
    rutUsuario:
      envValue("SII_RUT_USUARIO", env) || envValue("DTE_CERT_REPRESENTATIVE_RUT", env) || null,
    timeoutMs: Number(envValue("DTE_SII_TIMEOUT_MS", env) || 30_000),
    enableSubmit: envValue("DTE_SII_ENABLE_SUBMIT", env) === "true",
  };
}

function toRejectReason(error: unknown): SiiRejectReason {
  const siiError = toSiiCertificationError(error);
  return {
    code: siiError.code,
    message: siiError.message,
    field: siiError.field,
  };
}

function normalizeConfig(
  config: SiiClientConfig | SiiCertificationConfig,
): SiiCertificationConfig {
  if ("seedUrl" in config) return config;
  if (config.environment === "production") {
    throw new SiiCertificationError(
      SII_ERROR_CODES.PRODUCTION_DISABLED,
      "Production SII bloqueado hasta aprobacion real.",
      "environment",
    );
  }
  return {
    environment: "certification",
    seedUrl: config.baseUrl ?? "",
    tokenUrl: config.baseUrl ?? "",
    submitUrl: config.baseUrl ?? "",
    statusUrl: config.baseUrl ?? "",
    rutEmpresa: config.rutEmpresa ?? null,
    rutUsuario: config.rutUsuario ?? null,
    timeoutMs: config.timeoutMs ?? 30_000,
    enableSubmit: false,
  };
}

export async function prepareCertificationAuthFlow(
  config: SiiCertificationConfig,
  options: { dryRun?: boolean; seed?: string; privateKeyPem?: string | null } = {},
) {
  const seed =
    options.seed ??
    (await requestSeed(config, { dryRun: options.dryRun })).seed ??
    "DRY-RUN-SEED-NO-SII-CONTACT";
  const signedSeed = signSeed(seed, config, {
    privateKeyPem:
      options.privateKeyPem ??
      (config.privateKeyPath && existsSync(config.privateKeyPath)
        ? readFileSync(config.privateKeyPath, "utf8")
        : null),
  });
  const token = await requestToken(signedSeed.signedSeed ?? "", config, {
    dryRun: options.dryRun,
  });

  return { seed, signedSeed, token };
}

export async function submitCertificationSet(
  input: SiiCertificationSubmitInput & {
    token?: string | null;
    issuerRut?: string | null;
    companyRut?: string | null;
    xmlPath?: string | null;
    xsdValidated?: boolean;
    dryRun?: boolean;
  },
): Promise<SiiSendResult | SiiSubmitCertificationResult> {
  const config = normalizeConfig(input.config);
  try {
    return await submitSet(config, {
      xml: input.signedEnvioDteXml,
      xmlPath: input.xmlPath,
      xsdValidated: Boolean(input.xsdValidated),
      token: input.token,
      issuerRut: input.issuerRut ?? config.rutEmpresa ?? "",
      companyRut: input.companyRut ?? config.rutEmpresa ?? "",
      fileName: input.fileName,
      dryRun: input.dryRun,
    });
  } catch (error) {
    return {
      ok: false,
      environment: "certification",
      trackId: null,
      status: "error",
      errors: [toRejectReason(error)],
      isProductionValid: false,
    };
  }
}

export async function getSubmissionStatus(
  trackId: string,
  config: SiiClientConfig | SiiCertificationConfig,
  options: { token?: string | null; dryRun?: boolean } = {},
): Promise<SiiTrackStatusResult> {
  const normalized = normalizeConfig(config);
  try {
    const result = await getStatus(normalized, {
      trackId,
      token: options.token,
      dryRun: options.dryRun,
    });
    return {
      ok: result.ok,
      environment: "certification",
      trackId: result.trackId,
      siiStatus:
        result.siiStatus === "accepted"
          ? "accepted"
          : result.siiStatus === "rejected"
            ? "rejected"
            : result.siiStatus === "failed"
              ? "error"
              : result.siiStatus === "unknown"
                ? "unknown"
                : "pending",
      errors: [],
      checkedAt: result.checkedAt,
      isProductionValid: false,
    };
  } catch (error) {
    return {
      ok: false,
      environment: "certification",
      trackId,
      siiStatus: "error",
      errors: [toRejectReason(error)],
      checkedAt: new Date().toISOString(),
      isProductionValid: false,
    };
  }
}

export async function queryCertificationDte(input: SiiDteQueryInput, config: SiiClientConfig | SiiCertificationConfig): Promise<SiiDteQueryResult & { tokenSource: "rawTokenFromRequestToken"; tokenLengthValid: true; tokenExactMatch: true }> { const normalized = normalizeConfig(config); const auth = await prepareCertificationAuthFlow(normalized); const rawToken = auth.token.token ?? ""; const tokenLengthValid = rawToken.length >= 1 && rawToken.length <= 40; const tokenExactMatch = Boolean(auth.token.tokenFingerprint && auth.token.tokenFingerprint === fingerprintToken(rawToken)); if (!tokenLengthValid || !tokenExactMatch) throw new SiiCertificationError(SII_ERROR_CODES.INVALID_RESPONSE, "Token SII invalido para QueryEstDte.", "token"); const result = await queryDteStatus(normalized, input, { token: rawToken }); return { ...result, tokenSource: "rawTokenFromRequestToken", tokenLengthValid: true, tokenExactMatch: true }; }

export function parseSiiResponse(rawResponse: unknown): SiiParsedResponse {
  return parseSiiSubmissionResponse(rawResponse);
}

export {
  mapRawSiiStatus,
  mapSiiStatusToInternalStatus,
  parseSiiStatusResponse,
  parseSiiSubmissionResponse,
  requestSeed,
  requestToken,
  signSeed,
};
