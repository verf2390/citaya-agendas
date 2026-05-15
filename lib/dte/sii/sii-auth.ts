import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { validateRut } from "../rut";
import { SII_ERROR_CODES, SiiCertificationError, assertCertificationEnvironment, redactToken } from "./sii-errors";
import type {
  SiiCertificationConfig,
  SiiSeedResult,
  SiiSignedSeedResult,
  SiiTokenResult,
} from "./sii-types";

function now(): string {
  return new Date().toISOString();
}

function requireEndpoint(value: string, field: string): void {
  if (!value.trim()) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.ENDPOINT_MISSING,
      `Falta endpoint SII certification: ${field}`,
      field,
    );
  }
}

function extractXmlValue(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, "i"));
  return match?.[1]?.trim() || null;
}

export function validateSiiAuthConfig(config: SiiCertificationConfig): void {
  assertCertificationEnvironment(config.environment);
  requireEndpoint(config.seedUrl, "DTE_SII_SEED_URL");
  requireEndpoint(config.tokenUrl, "DTE_SII_TOKEN_URL");
  if (!config.certPath || !existsSync(config.certPath)) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.CERTIFICATE_MISSING,
      "Falta certificado real externo para seed/token SII.",
      "DTE_CERT_PATH",
    );
  }
  if (!config.privateKeyPath || !existsSync(config.privateKeyPath)) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.PRIVATE_KEY_MISSING,
      "Falta private key real externa para firmar seed SII.",
      "DTE_PRIVATE_KEY_PATH",
    );
  }
  if (config.rutEmpresa && !validateRut(config.rutEmpresa)) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "RUT empresa SII invalido.",
      "SII_RUT_EMPRESA",
    );
  }
}

export async function requestSeed(
  config: SiiCertificationConfig,
  options: { dryRun?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<SiiSeedResult> {
  assertCertificationEnvironment(config.environment);
  requireEndpoint(config.seedUrl, "DTE_SII_SEED_URL");

  if (options.dryRun) {
    return {
      ok: false,
      status: "pending_real_certification",
      message: "Seed SII preparado en dry-run; no se contacto ambiente certification.",
      requestedAt: now(),
      environment: "certification",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(config.seedUrl, { method: "GET" });
  const text = await response.text();
  const seed = extractXmlValue(text, "SEMILLA") ?? extractXmlValue(text, "seed");

  if (!response.ok || !seed) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_RESPONSE,
      "Respuesta seed SII no contiene SEMILLA clara.",
    );
  }

  return {
    ok: true,
    seed,
    status: "ready",
    message: "Seed SII obtenido desde ambiente certification.",
    requestedAt: now(),
    environment: "certification",
  };
}

export function signSeed(
  seed: string,
  config: SiiCertificationConfig,
  options: { privateKeyPem?: string | null } = {},
): SiiSignedSeedResult {
  assertCertificationEnvironment(config.environment);
  if (!seed.trim()) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "Seed SII vacio.",
      "seed",
    );
  }

  const privateKeyPem =
    options.privateKeyPem ??
    (config.privateKeyPath && existsSync(config.privateKeyPath)
      ? readFileSync(config.privateKeyPath, "utf8")
      : null);

  if (!privateKeyPem) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.PRIVATE_KEY_MISSING,
      "No se puede firmar seed sin private key externa.",
      "DTE_PRIVATE_KEY_PATH",
    );
  }

  const signer = createSign("RSA-SHA256");
  signer.update(seed);
  signer.end();

  return {
    ok: true,
    signedSeed: signer.sign(privateKeyPem, "base64"),
    status: "ready",
    message: "Seed firmado localmente con Node crypto; no implica token SII valido.",
    signedAt: now(),
    environment: "certification",
  };
}

export async function requestToken(
  signedSeed: string,
  config: SiiCertificationConfig,
  options: { dryRun?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<SiiTokenResult> {
  assertCertificationEnvironment(config.environment);
  requireEndpoint(config.tokenUrl, "DTE_SII_TOKEN_URL");
  if (!signedSeed.trim()) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "Seed firmado vacio.",
      "signedSeed",
    );
  }

  if (options.dryRun) {
    return {
      ok: false,
      status: "pending_real_certification",
      message: `${SII_ERROR_CODES.TOKEN_PENDING_REAL_CERTIFICATION}: token no solicitado en dry-run.`,
      requestedAt: now(),
      environment: "certification",
      redactedToken: null,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/xml; charset=ISO-8859-1" },
    body: signedSeed,
  });
  const text = await response.text();
  const token = extractXmlValue(text, "TOKEN") ?? extractXmlValue(text, "token");

  if (!response.ok || !token) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_RESPONSE,
      "Respuesta token SII no contiene TOKEN claro.",
    );
  }

  return {
    ok: true,
    token,
    redactedToken: redactToken(token),
    status: "ready",
    message: "Token SII obtenido y redactado para logs.",
    requestedAt: now(),
    environment: "certification",
  };
}
