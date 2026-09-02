import {
  BOLETA_API_ENVIRONMENT_CONFIG,
  requestBoletaRestSeed,
  requestBoletaRestToken,
  signBoletaRestSeed,
} from "../certification/boleta39-rest-api";
import {
  buildGetSeedSoapEnvelope,
  buildGetTokenSoapEnvelope,
  parseSeedSoapResponse,
  parseTokenSoapResponse,
  signSiiSeedXml,
} from "../sii/sii-auth";
import type { ProductionRuntimeConfig } from "./config";
import type { ProductionSiiMilestone } from "./sii-client";
import type { ProductionTenantSettings } from "./types";
import { loadValidatedProductionSigningMaterial } from "./signing-material";

export async function requestProductionStatusToken(input: {
  config: ProductionRuntimeConfig;
  settings: ProductionTenantSettings;
  milestone: (event: ProductionSiiMilestone) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const signingMaterial = loadValidatedProductionSigningMaterial({
    certificatePath: input.settings.certificatePath,
    privateKeyPath: input.settings.privateKeyPath,
    config: input.config,
  });
  await input.milestone("seed_before_fetch");
  const seedResponse = await fetchImpl(input.config.seedUrl, {
    method: "POST",
    headers: { "content-type": "text/xml; charset=utf-8", soapaction: "" },
    body: buildGetSeedSoapEnvelope(),
    signal: AbortSignal.timeout(input.config.timeoutMs),
  });
  const seedParsed = parseSeedSoapResponse(await seedResponse.text());
  await input.milestone("seed_after_fetch");
  if (
    !seedResponse.ok ||
    !seedParsed.semilla ||
    !["0", "00", "OK"].includes(String(seedParsed.estado ?? "").toUpperCase())
  )
    throw new Error("DTE_SII_SEED_REJECTED");
  const signed = signSiiSeedXml(
    seedParsed.semilla,
    signingMaterial.privateKeyPem,
    signingMaterial.certificatePem,
  );
  await input.milestone("token_before_fetch");
  const tokenResponse = await fetchImpl(input.config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "text/xml; charset=utf-8", soapaction: "" },
    body: buildGetTokenSoapEnvelope(signed),
    signal: AbortSignal.timeout(input.config.timeoutMs),
  });
  const tokenParsed = parseTokenSoapResponse(await tokenResponse.text());
  await input.milestone("token_after_fetch");
  if (
    !tokenResponse.ok ||
    !tokenParsed.token ||
    !["0", "00", "OK"].includes(String(tokenParsed.estado ?? "").toUpperCase())
  )
    throw new Error("DTE_SII_TOKEN_REJECTED");
  return tokenParsed.token;
}

export async function requestProductionBoletaStatusToken(input: {
  config: ProductionRuntimeConfig;
  settings: ProductionTenantSettings;
  milestone: (event: ProductionSiiMilestone) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const endpoints = BOLETA_API_ENVIRONMENT_CONFIG[input.config.environment];
  const signingMaterial = loadValidatedProductionSigningMaterial({
    certificatePath: input.settings.certificatePath,
    privateKeyPath: input.settings.privateKeyPath,
    config: input.config,
  });

  await input.milestone("seed_before_fetch");
  const seedResult = await requestBoletaRestSeed({
    environment: input.config.environment,
    seedUrl: `${endpoints.authBaseUrl}/boleta.electronica.semilla`,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.config.timeoutMs,
  });
  await input.milestone("seed_after_fetch");
  if (seedResult.data.estado !== "00" || !seedResult.data.seed) {
    throw new Error("DTE_BOLETA_STATUS_SEED_REJECTED");
  }

  const signedSeed = signBoletaRestSeed(
    seedResult.data.seed,
    signingMaterial.privateKeyPem,
    signingMaterial.certificatePem,
  );

  await input.milestone("token_before_fetch");
  const tokenResult = await requestBoletaRestToken(signedSeed.signedXml, {
    environment: input.config.environment,
    tokenUrl: `${endpoints.authBaseUrl}/boleta.electronica.token`,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.config.timeoutMs,
  });
  await input.milestone("token_after_fetch");
  if (tokenResult.data.estado !== "00" || !tokenResult.data.token) {
    throw new Error("DTE_BOLETA_STATUS_TOKEN_REJECTED");
  }
  return tokenResult.data.token;
}

export function requestProductionStatusTokenForDteType(input: {
  config: ProductionRuntimeConfig;
  settings: ProductionTenantSettings;
  dteType: number;
  milestone: (event: ProductionSiiMilestone) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  return [39, 41].includes(input.dteType)
    ? requestProductionBoletaStatusToken(input)
    : requestProductionStatusToken(input);
}
