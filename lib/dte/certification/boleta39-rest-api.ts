import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
} from "node:crypto";

import { DOMParser } from "@xmldom/xmldom";
import { C14nCanonicalization } from "xml-crypto";

import { validateRut } from "../rut";
import {
  buildSiiSeedKeyInfoContent,
  verifySignedSeedXml,
} from "../sii/sii-auth";

export type BoletaApiEnvironment =
  | "certification"
  | "production";

export type BoletaApiEnvironmentConfig = {
  authBaseUrl: string;
  uploadBaseUrl: string;
  queryBaseUrl: string;
};

export const BOLETA_API_ENVIRONMENT_CONFIG = {
  certification: {
    authBaseUrl: "https://apicert.sii.cl/recursos/v1",
    uploadBaseUrl: "https://pangal.sii.cl/recursos/v1",
    queryBaseUrl: "https://apicert.sii.cl/recursos/v1",
  },
  production: {
    authBaseUrl: "https://api.sii.cl/recursos/v1",
    uploadBaseUrl: "https://rahue.sii.cl/recursos/v1",
    queryBaseUrl: "https://api.sii.cl/recursos/v1",
  },
} as const satisfies Record<
  BoletaApiEnvironment,
  BoletaApiEnvironmentConfig
>;

export function assertBoletaApiEnvironmentHosts(
  environment: BoletaApiEnvironment,
  config: BoletaApiEnvironmentConfig =
    BOLETA_API_ENVIRONMENT_CONFIG[environment],
): BoletaApiEnvironmentConfig {
  const expected =
    BOLETA_API_ENVIRONMENT_CONFIG[environment];

  if (
    config.authBaseUrl !== expected.authBaseUrl ||
    config.uploadBaseUrl !== expected.uploadBaseUrl ||
    config.queryBaseUrl !== expected.queryBaseUrl
  ) {
    throw new Error(
      "DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH",
    );
  }

  return config;
}

export const BOLETA_CERTIFICATION_API_BASE =
  BOLETA_API_ENVIRONMENT_CONFIG.certification.authBaseUrl;

export const BOLETA_CERTIFICATION_SEED_URL =
  `${BOLETA_CERTIFICATION_API_BASE}/boleta.electronica.semilla`;

export const BOLETA_CERTIFICATION_TOKEN_URL =
  `${BOLETA_CERTIFICATION_API_BASE}/boleta.electronica.token`;

export const BOLETA_CERTIFICATION_SUBMIT_URL =
  `${BOLETA_API_ENVIRONMENT_CONFIG.certification.uploadBaseUrl}/boleta.electronica.envio`;

export const BOLETA_PRODUCTION_API_BASE =
  BOLETA_API_ENVIRONMENT_CONFIG.production.queryBaseUrl;

export const BOLETA_PRODUCTION_AUTH_BASE =
  BOLETA_API_ENVIRONMENT_CONFIG.production.authBaseUrl;

export const BOLETA_PRODUCTION_UPLOAD_BASE =
  BOLETA_API_ENVIRONMENT_CONFIG.production.uploadBaseUrl;

export const BOLETA_PRODUCTION_QUERY_BASE =
  BOLETA_API_ENVIRONMENT_CONFIG.production.queryBaseUrl;

export const BOLETA_PRODUCTION_SEED_URL =
  `${BOLETA_PRODUCTION_AUTH_BASE}/boleta.electronica.semilla`;

export const BOLETA_PRODUCTION_TOKEN_URL =
  `${BOLETA_PRODUCTION_AUTH_BASE}/boleta.electronica.token`;

export const BOLETA_PRODUCTION_SUBMIT_URL =
  `${BOLETA_PRODUCTION_UPLOAD_BASE}/boleta.electronica.envio`;

export const BOLETA_CERTIFICATION_USER_AGENT =
  "Mozilla/4.0 ( compatible; Citaya 1.0; Linux )";

const XMLDSIG_NAMESPACE =
  "http://www.w3.org/2000/09/xmldsig#";

const XMLDSIG_C14N =
  "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

const XMLDSIG_RSA_SHA1 =
  "http://www.w3.org/2000/09/xmldsig#rsa-sha1";

const XMLDSIG_ENVELOPED =
  "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

const XMLDSIG_SHA1 =
  "http://www.w3.org/2000/09/xmldsig#sha1";

const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8"?>';

export type BoletaRestSignedSeed = {
  unsignedXml: string;
  signedXml: string;
  digestValue: string;
  signedXmlSha256: string;
  verified: true;
};

export type BoletaRestSeedResponse = {
  estado: string;
  glosa: string | null;
  seed: string;
};

export type BoletaRestTokenResponse = {
  estado: string;
  glosa: string | null;
  token: string;
};

export type BoletaRestSubmitResponse = {
  rutEmisor: string;
  rutEnvia: string;
  trackId: string;
  receptionDate: string;
  status: "REC";
  fileName: string;
};

export class BoletaRestSubmitHttpError extends Error {
  public readonly status: number;
  public readonly responseText: string;
  public readonly contentType: string;
  public readonly responseBytes: number;
  public readonly responseHeaderNames: string[];
  public readonly wwwAuthenticate: string | null;
  public readonly host: string;
  public readonly timestamp: string;
  public readonly requestId: string | null;
  public readonly correlationId: string | null;

  constructor(input: {
    status: number;
    responseText: string;
    contentType: string;
    responseBytes: number;
    responseHeaderNames: string[];
    wwwAuthenticate: string | null;
    host: string;
    timestamp: string;
    requestId: string | null;
    correlationId: string | null;
  }) {
    const message =
      `BOLETA_REST_SUBMIT_HTTP_${input.status}`;

    super(message);

    this.name = "BoletaRestSubmitHttpError";
    this.status = input.status;
    this.responseText = input.responseText;
    this.contentType = input.contentType;
    this.responseBytes = input.responseBytes;
    this.responseHeaderNames = [...input.responseHeaderNames];
    this.wwwAuthenticate = input.wwwAuthenticate;
    this.host = input.host;
    this.timestamp = input.timestamp;
    this.requestId = input.requestId;
    this.correlationId = input.correlationId;

    Object.setPrototypeOf(
      this,
      BoletaRestSubmitHttpError.prototype,
    );
  }
}

export type BoletaRestSubmitFailureCategory =
  | "AUTH_FAILURE"
  | "HTTP_FAILURE"
  | "NETWORK_OR_TIMEOUT";

export function classifyBoletaRestSubmitFailure(
  error: unknown,
): BoletaRestSubmitFailureCategory {
  if (
    error instanceof BoletaRestSubmitHttpError &&
    error.status === 401
  ) {
    return "AUTH_FAILURE";
  }

  if (error instanceof BoletaRestSubmitHttpError) {
    return "HTTP_FAILURE";
  }

  return "NETWORK_OR_TIMEOUT";
}

function sha1Base64(value: string): string {
  return createHash("sha1")
    .update(value, "utf8")
    .digest("base64");
}

function sha256(value: string): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function assertSeed(seed: string): void {
  if (!/^[0-9]{1,40}$/.test(seed)) {
    throw new Error("BOLETA_REST_SEED_INVALID");
  }
}

function assertCertificateKeyPair(
  certificatePem: string,
  privateKeyPem: string,
): void {
  try {
    const certificateKey = createPublicKey(
      certificatePem,
    ).export({
      type: "spki",
      format: "der",
    });

    const privateKey = createPublicKey(
      createPrivateKey(privateKeyPem),
    ).export({
      type: "spki",
      format: "der",
    });

    if (
      !Buffer.from(certificateKey).equals(
        Buffer.from(privateKey),
      )
    ) {
      throw new Error("key_pair_mismatch");
    }
  } catch {
    throw new Error(
      "BOLETA_REST_CERTIFICATE_KEY_PAIR_INVALID",
    );
  }
}

function parseXml(xml: string) {
  const document = new DOMParser().parseFromString(
    xml,
    "text/xml",
  );

  if (
    document.getElementsByTagName("parsererror").length > 0
  ) {
    throw new Error("BOLETA_REST_XML_RESPONSE_INVALID");
  }

  return document;
}

function textByLocalName(
  xml: string,
  expectedName: string,
): string | null {
  const document = parseXml(xml);

  const elements = [
    ...(document.documentElement
      ? [document.documentElement]
      : []),
    ...Array.from(document.getElementsByTagName("*")),
  ];

  const match = elements.find((element) => {
    const localName = String(
      element.localName || element.nodeName,
    ).replace(/^.*:/, "");

    return localName === expectedName;
  });

  return match?.textContent?.trim() || null;
}

function statusIsOk(value: string | null): boolean {
  return value === "0" || value === "00";
}

export function splitRut(value: string): {
  rut: string;
  dv: string;
} {
  const normalized = value
    .replace(/\./g, "")
    .trim()
    .toUpperCase();

  const match = normalized.match(
    /^([0-9]{7,8})-([0-9K])$/,
  );

  if (!match || !validateRut(normalized)) {
    throw new Error("BOLETA_REST_RUT_INVALID");
  }

  return {
    rut: match[1],
    dv: match[2],
  };
}

export function buildBoletaRestUnsignedTokenXml(
  seed: string,
): string {
  assertSeed(seed);

  const root =
    `<getToken><item><Semilla>${seed}` +
    "</Semilla></item></getToken>";

  return `${XML_DECLARATION}\n${root}`;
}

export function signBoletaRestSeed(
  seed: string,
  privateKeyPem: string,
  certificatePem: string,
): BoletaRestSignedSeed {
  assertSeed(seed);

  if (
    !privateKeyPem.trim() ||
    !certificatePem.trim()
  ) {
    throw new Error(
      "BOLETA_REST_SIGNING_MATERIAL_MISSING",
    );
  }

  assertCertificateKeyPair(
    certificatePem,
    privateKeyPem,
  );

  const unsignedXml =
    buildBoletaRestUnsignedTokenXml(seed);

  const unsignedRoot =
    `<getToken><item><Semilla>${seed}` +
    "</Semilla></item></getToken>";

  const digestValue = sha1Base64(unsignedRoot);

  const signedInfoChildren = [
    `<CanonicalizationMethod Algorithm="${XMLDSIG_C14N}"/>`,
    `<SignatureMethod Algorithm="${XMLDSIG_RSA_SHA1}"/>`,
    '<Reference URI="">',
    "<Transforms>",
    `<Transform Algorithm="${XMLDSIG_ENVELOPED}"/>`,
    "</Transforms>",
    `<DigestMethod Algorithm="${XMLDSIG_SHA1}"/>`,
    `<DigestValue>${digestValue}</DigestValue>`,
    "</Reference>",
  ].join("");

  const standaloneSignedInfo =
    `<SignedInfo xmlns="${XMLDSIG_NAMESPACE}">` +
    signedInfoChildren +
    "</SignedInfo>";

  const signedInfoDocument = parseXml(
    standaloneSignedInfo,
  );

  const canonicalizer =
    new C14nCanonicalization();

  const signedInfoRoot =
    signedInfoDocument.documentElement;

  if (!signedInfoRoot) {
    throw new Error(
      "BOLETA_REST_SIGNED_INFO_ROOT_MISSING",
    );
  }

  const canonicalSignedInfo = String(
    canonicalizer.process(
      signedInfoRoot as unknown as Parameters<
        C14nCanonicalization["process"]
      >[0],
      {},
    ),
  );

  const signer = createSign("RSA-SHA1");

  signer.update(canonicalSignedInfo, "utf8");
  signer.end();

  const signatureValue = signer.sign(
    privateKeyPem,
    "base64",
  );

  const keyInfo =
    buildSiiSeedKeyInfoContent(certificatePem);

  const signatureXml = [
    `<Signature xmlns="${XMLDSIG_NAMESPACE}">`,
    "<SignedInfo>",
    signedInfoChildren,
    "</SignedInfo>",
    `<SignatureValue>${signatureValue}</SignatureValue>`,
    `<KeyInfo>${keyInfo}</KeyInfo>`,
    "</Signature>",
  ].join("");

  const signedRoot = unsignedRoot.replace(
    "</item></getToken>",
    `</item>${signatureXml}</getToken>`,
  );

  const signedXml =
    `${XML_DECLARATION}\n${signedRoot}`;

  if (signedXml.endsWith("\n")) {
    throw new Error(
      "BOLETA_REST_SIGNED_XML_TRAILING_NEWLINE",
    );
  }

  if (
    !signedXml.includes('<Reference URI="">')
  ) {
    throw new Error(
      "BOLETA_REST_REFERENCE_URI_NOT_EMPTY",
    );
  }

  if (
    !verifySignedSeedXml(
      signedXml,
      certificatePem,
    )
  ) {
    throw new Error(
      "BOLETA_REST_SIGNATURE_VERIFICATION_FAILED",
    );
  }

  const recoveredUnsigned = signedXml.replace(
    /<Signature\b[\s\S]*?<\/Signature>/,
    "",
  );

  if (recoveredUnsigned !== unsignedXml) {
    throw new Error(
      "BOLETA_REST_UNSIGNED_XML_NOT_RECOVERABLE",
    );
  }

  return {
    unsignedXml,
    signedXml,
    digestValue,
    signedXmlSha256: sha256(signedXml),
    verified: true,
  };
}

export function parseBoletaRestSeedResponse(
  xml: string,
): BoletaRestSeedResponse {
  const estado = textByLocalName(
    xml,
    "ESTADO",
  );

  const glosa = textByLocalName(
    xml,
    "GLOSA",
  );

  const seed =
    textByLocalName(xml, "SEMILLA") ??
    textByLocalName(xml, "Semilla");

  if (
    !statusIsOk(estado) ||
    !seed ||
    !/^[0-9]{1,40}$/.test(seed)
  ) {
    throw new Error(
      "BOLETA_REST_SEED_RESPONSE_INVALID",
    );
  }

  return {
    estado: estado!,
    glosa,
    seed,
  };
}

export function parseBoletaRestTokenResponse(
  xml: string,
): BoletaRestTokenResponse {
  const estado = textByLocalName(
    xml,
    "ESTADO",
  );

  const glosa = textByLocalName(
    xml,
    "GLOSA",
  );

  const token =
    textByLocalName(xml, "TOKEN") ??
    textByLocalName(xml, "Token");

  if (
    !statusIsOk(estado) ||
    !token ||
    token.length > 500
  ) {
    throw new Error(
      "BOLETA_REST_TOKEN_RESPONSE_INVALID",
    );
  }

  return {
    estado: estado!,
    glosa,
    token,
  };
}

export function parseBoletaRestSubmitResponse(
  raw: string,
): BoletaRestSubmitResponse {
  let value: Record<string, unknown>;

  try {
    value = JSON.parse(raw) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_NOT_JSON",
    );
  }

  const trackId = String(
    value.trackid ?? "",
  );

  if (
    value.estado !== "REC" ||
    !/^[0-9]{1,15}$/.test(trackId)
  ) {
    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_INVALID",
    );
  }

  return {
    rutEmisor: String(value.rut_emisor ?? ""),
    rutEnvia: String(value.rut_envia ?? ""),
    trackId,
    receptionDate: String(
      value.fecha_recepcion ?? "",
    ),
    status: "REC",
    fileName: String(value.file ?? ""),
  };
}

export function parseBoletaRetryAfter(
  value: string | null,
): number | null {
  if (!value || !/^[0-9]{1,5}$/.test(value)) {
    return null;
  }

  const seconds = Number(value);

  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    seconds > 86_400
  ) {
    return null;
  }

  return seconds;
}

export type RcofResponseEvaluation = {
  received: boolean;
  trackId: string;
  status: "ACCEPTED" | "REPARO_INFORMATIONAL" | "REJECTED";
  blocking: boolean;
  errors: number;
  reparos: number;
  warningCode: number | null;
  rcofRequired: false;
  description: string;
  detail: string;
};

export function evaluateRcofResponse(input: {
  trackId: string | number;
  estado: string;
  errores?: number;
  reparos?: number;
  codigo?: number | string;
  descripcion?: string;
  detalle?: string;
}): RcofResponseEvaluation {
  const trackId = String(input.trackId ?? "");
  const rawStatus = String(input.estado ?? "").toUpperCase();
  const errors = Number(input.errores ?? 0);
  const reparos = Number(input.reparos ?? 0);
  const warningCode =
    input.codigo !== undefined && input.codigo !== null
      ? Number(input.codigo)
      : null;
  const description = String(input.descripcion ?? "");
  const detail = String(input.detalle ?? "");

  if (
    warningCode === 250 ||
    /RVD no es obligatorio/i.test(description || detail) ||
    (rawStatus === "REPARO" && errors === 0 && warningCode === 250)
  ) {
    return {
      received: true,
      trackId,
      status: "REPARO_INFORMATIONAL",
      blocking: false,
      errors: 0,
      reparos,
      warningCode: 250,
      rcofRequired: false,
      description:
        description || "Envío de RVD no es obligatorio desde agosto 2022",
      detail: detail || "RVD no es obligatorio desde 2022-08-01",
    };
  }

  if (
    rawStatus === "REC" ||
    rawStatus === "ACEPTADO" ||
    rawStatus === "EOK" ||
    (rawStatus === "REPARO" && errors === 0)
  ) {
    return {
      received: true,
      trackId,
      status: rawStatus === "REPARO" ? "REPARO_INFORMATIONAL" : "ACCEPTED",
      blocking: false,
      errors,
      reparos,
      warningCode,
      rcofRequired: false,
      description,
      detail,
    };
  }

  return {
    received: true,
    trackId,
    status: "REJECTED",
    blocking: errors > 0,
    errors,
    reparos,
    warningCode,
    rcofRequired: false,
    description,
    detail,
  };
}

export function buildBoletaRestStatusUrl(
  companyRut: string,
  trackId: string,
  apiBaseUrl: string = BOLETA_CERTIFICATION_API_BASE,
): string {
  const company = splitRut(companyRut);

  if (!/^[0-9]{1,15}$/.test(trackId)) {
    throw new Error(
      "BOLETA_REST_TRACK_ID_INVALID",
    );
  }

  return (
    `${apiBaseUrl}` +
    "/boleta.electronica.envio/" +
    `${company.rut}-${company.dv}-${trackId}`
  );
}

export function buildBoletaDocumentStatusUrl(input: {
  environment: BoletaApiEnvironment;
  companyRut: string;
  dteType: 39 | 41;
  folio: number;
  recipientRut: string;
  amount: number;
  issueDate: string;
  queryBaseUrl?: string;
}): string {
  const environmentConfig =
    assertBoletaApiEnvironmentHosts(input.environment);
  const queryBaseUrl =
    input.queryBaseUrl ?? environmentConfig.queryBaseUrl;
  if (queryBaseUrl !== environmentConfig.queryBaseUrl) {
    throw new Error("DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH");
  }

  const company = splitRut(input.companyRut);
  const recipient = splitRut(input.recipientRut);
  if (!Number.isSafeInteger(input.folio) || input.folio < 1) {
    throw new Error("BOLETA_API_FOLIO_INVALID");
  }
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) {
    throw new Error("BOLETA_API_AMOUNT_INVALID");
  }
  if (!/^\d{2}-\d{2}-\d{4}$/.test(input.issueDate)) {
    throw new Error("BOLETA_API_ISSUE_DATE_INVALID");
  }

  const query = new URLSearchParams({
    rut_receptor: recipient.rut,
    dv_receptor: recipient.dv,
    monto: String(input.amount),
    fechaEmision: input.issueDate,
  });

  return (
    `${queryBaseUrl}/boleta.electronica/` +
    `${company.rut}-${company.dv}-${input.dteType}-${input.folio}/estado?${query}`
  );
}

export type BoletaRestHttpOptions = {
  environment?: BoletaApiEnvironment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type BoletaRestHttpResult<T> = {
  data: T;
  contentType: string;
  responseBytes: number;
};

const BOLETA_REST_AUTH_DEFAULT_TIMEOUT_MS =
  15_000;

const BOLETA_REST_AUTH_MAX_RESPONSE_BYTES =
  64 * 1024;

function resolveBoletaRestTimeout(
  value: number | undefined,
): number {
  const timeout =
    value ??
    BOLETA_REST_AUTH_DEFAULT_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1_000 ||
    timeout > 60_000
  ) {
    throw new Error(
      "BOLETA_REST_AUTH_TIMEOUT_INVALID",
    );
  }

  return timeout;
}

function assertBoletaRestAuthUrl(
  url: string,
): void {
  const allowed = new Set([
    BOLETA_CERTIFICATION_SEED_URL,
    BOLETA_CERTIFICATION_TOKEN_URL,
    BOLETA_PRODUCTION_SEED_URL,
    BOLETA_PRODUCTION_TOKEN_URL,
  ]);

  if (!allowed.has(url)) {
    throw new Error(
      "BOLETA_REST_AUTH_URL_NOT_ALLOWED",
    );
  }
}

function assertSignedTokenRequestXml(
  signedXml: string,
): void {
  if (
    !signedXml.startsWith(
      '<?xml version="1.0" encoding="UTF-8"?>\n',
    ) ||
    signedXml.endsWith("\n") ||
    !signedXml.includes(
      '<Reference URI="">',
    ) ||
    !signedXml.includes(
      "<Signature ",
    ) ||
    !signedXml.endsWith(
      "</Signature></getToken>",
    )
  ) {
    throw new Error(
      "BOLETA_REST_SIGNED_TOKEN_XML_INVALID",
    );
  }

  parseXml(signedXml);
}

async function readBoletaRestXmlResponse(
  response: Response,
  operation: "seed" | "token",
): Promise<{
  xml: string;
  contentType: string;
  responseBytes: number;
}> {
  if (response.status !== 200) {
    throw new Error(
      `BOLETA_REST_${operation.toUpperCase()}_HTTP_${response.status}`,
    );
  }

  const contentType =
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";

  if (
    contentType !== "application/xml" &&
    contentType !== "text/xml"
  ) {
    throw new Error(
      `BOLETA_REST_${operation.toUpperCase()}_CONTENT_TYPE_INVALID`,
    );
  }

  const bytes = Buffer.from(
    await response.arrayBuffer(),
  );

  if (
    bytes.length === 0 ||
    bytes.length >
      BOLETA_REST_AUTH_MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      `BOLETA_REST_${operation.toUpperCase()}_RESPONSE_SIZE_INVALID`,
    );
  }

  let xml: string;

  try {
    xml = new TextDecoder(
      "utf-8",
      {
        fatal: true,
      },
    ).decode(bytes);
  } catch {
    throw new Error(
      `BOLETA_REST_${operation.toUpperCase()}_UTF8_INVALID`,
    );
  }

  return {
    xml,
    contentType,
    responseBytes: bytes.length,
  };
}

async function performBoletaRestXmlRequest(
  options: {
    operation: "seed" | "token";
    url: string;
    method: "GET" | "POST";
    body?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{
  xml: string;
  contentType: string;
  responseBytes: number;
}> {
  assertBoletaRestAuthUrl(
    options.url,
  );

  const timeoutMs =
    resolveBoletaRestTimeout(
      options.timeoutMs,
    );

  const fetchImpl =
    options.fetchImpl ??
    globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error(
      "BOLETA_REST_FETCH_UNAVAILABLE",
    );
  }

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    const headers: Record<string, string> = {
      Accept: "application/xml",
      "Cache-Control": "no-store",
    };

    if (
      options.method === "POST"
    ) {
      headers["Content-Type"] =
        "application/xml; charset=UTF-8";
    }

    const response = await fetchImpl(
      options.url,
      {
        method: options.method,
        headers,
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
      },
    );

    return await readBoletaRestXmlResponse(
      response,
      options.operation,
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `BOLETA_REST_${options.operation.toUpperCase()}_TIMEOUT`,
      );
    }

    if (
      error instanceof Error &&
      error.message.startsWith(
        "BOLETA_REST_",
      )
    ) {
      throw error;
    }

    throw new Error(
      `BOLETA_REST_${options.operation.toUpperCase()}_NETWORK_ERROR`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function requestBoletaRestSeed(
  options: BoletaRestHttpOptions & { seedUrl?: string } = {},
): Promise<
  BoletaRestHttpResult<BoletaRestSeedResponse>
> {
  const environment = options.environment ?? "certification";
  const environmentConfig = assertBoletaApiEnvironmentHosts(environment);
  const seedUrl =
    options.seedUrl ??
    `${environmentConfig.authBaseUrl}/boleta.electronica.semilla`;
  if (
    seedUrl !==
    `${environmentConfig.authBaseUrl}/boleta.electronica.semilla`
  ) {
    throw new Error("DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH");
  }
  const response =
    await performBoletaRestXmlRequest({
      operation: "seed",
      url: seedUrl,
      method: "GET",
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });

  return {
    data:
      parseBoletaRestSeedResponse(
        response.xml,
      ),
    contentType:
      response.contentType,
    responseBytes:
      response.responseBytes,
  };
}

export async function requestBoletaRestToken(
  signedXml: string,
  options: BoletaRestHttpOptions & { tokenUrl?: string } = {},
): Promise<
  BoletaRestHttpResult<BoletaRestTokenResponse>
> {
  assertSignedTokenRequestXml(
    signedXml,
  );

  const environment = options.environment ?? "certification";
  const environmentConfig = assertBoletaApiEnvironmentHosts(environment);
  const tokenUrl =
    options.tokenUrl ??
    `${environmentConfig.authBaseUrl}/boleta.electronica.token`;
  if (
    tokenUrl !==
    `${environmentConfig.authBaseUrl}/boleta.electronica.token`
  ) {
    throw new Error("DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH");
  }

  const response =
    await performBoletaRestXmlRequest({
      operation: "token",
      url: tokenUrl,
      method: "POST",
      body: signedXml,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });

  return {
    data:
      parseBoletaRestTokenResponse(
        response.xml,
      ),
    contentType:
      response.contentType,
    responseBytes:
      response.responseBytes,
  };
}

export type BoletaRestSubmitInput = {
  environment?: BoletaApiEnvironment;
  token: string;
  senderRut: string;
  companyRut: string;
  fileName: string;
  fileBytes: Uint8Array;
  submitUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
};

export type BoletaRestSubmitResult = {
  httpStatus: number;
  data: BoletaRestSubmitResponse;
  contentType: string;
  responseBytes: number;
  responseSha256: string;
  location: string | null;
  retryAfterSeconds: number | null;
  warning?: "FILE_NAME_MISMATCH" | null;
  sanitizedJson: Record<string, unknown>;
  responseBody: string;
};

const BOLETA_REST_SUBMIT_DEFAULT_TIMEOUT_MS =
  30_000;

const BOLETA_REST_SUBMIT_MAX_RESPONSE_BYTES =
  64 * 1024;

const BOLETA_REST_SUBMIT_MAX_FILE_BYTES =
  25 * 1024 * 1024;

function canonicalBoletaRestRut(
  value: string,
): string {
  const parts = splitRut(value);

  return `${parts.rut}-${parts.dv}`;
}

function assertBoletaRestToken(
  token: string,
): void {
  if (
    !/^[A-Za-z0-9._~-]{1,500}$/.test(
      token,
    )
  ) {
    throw new Error(
      "BOLETA_REST_SUBMIT_TOKEN_INVALID",
    );
  }
}

function assertBoletaRestFile(
  fileName: string,
  fileBytes: Uint8Array,
): void {
  if (
    !/^[A-Za-z0-9._-]{1,180}\.xml$/i.test(
      fileName,
    ) ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw new Error(
      "BOLETA_REST_SUBMIT_FILENAME_INVALID",
    );
  }

  if (
    fileBytes.byteLength === 0 ||
    fileBytes.byteLength >
      BOLETA_REST_SUBMIT_MAX_FILE_BYTES
  ) {
    throw new Error(
      "BOLETA_REST_SUBMIT_FILE_SIZE_INVALID",
    );
  }
}

function resolveBoletaRestSubmitTimeout(
  value: number | undefined,
): number {
  const timeout =
    value ??
    BOLETA_REST_SUBMIT_DEFAULT_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1_000 ||
    timeout > 120_000
  ) {
    throw new Error(
      "BOLETA_REST_SUBMIT_TIMEOUT_INVALID",
    );
  }

  return timeout;
}

function validateBoletaRestLocation(
  location: string | null,
  companyRut: string,
  trackId: string,
): string | null {
  if (!location) {
    return null;
  }

  const company =
    splitRut(companyRut);

  const route =
    `/boleta.electronica.envio/` +
    `${company.rut}-${company.dv}-${trackId}`;

  const allowed = new Set([
    route,
    `/recursos/v1${route}`,
    `${BOLETA_CERTIFICATION_API_BASE}${route}`,
    `${BOLETA_API_ENVIRONMENT_CONFIG.certification.uploadBaseUrl}${route}`,
    `${BOLETA_PRODUCTION_API_BASE}${route}`,
    `${BOLETA_PRODUCTION_UPLOAD_BASE}${route}`,
  ]);

  const normalized =
    location.trim();

  if (!allowed.has(normalized)) {
    throw new Error(
      "BOLETA_REST_SUBMIT_LOCATION_INVALID",
    );
  }

  return normalized;
}

function sanitizeBoletaRestResponseBody(
  raw: string,
  contentType: string,
): string {
  if (!raw || raw.length === 0) {
    return "EMPTY_RESPONSE";
  }

  let sanitized = raw;

  sanitized = sanitized.replace(
    /TOKEN=[^\s&,;}\]"]*/gi,
    "TOKEN=[REDACTED]",
  );

  sanitized = sanitized.replace(
    /Cookie:\s*TOKEN=[^\r\n]*/gi,
    "Cookie: [REDACTED]",
  );

  sanitized = sanitized.replace(
    /Authorization:\s*[^\r\n]*/gi,
    "Authorization: [REDACTED]",
  );

  sanitized = sanitized.replace(
    /-----BEGIN\s+(PRIVATE\s+)?RSA\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+(PRIVATE\s+)?RSA\s+PRIVATE\s+KEY-----/gi,
    "[REDACTED_PEM]",
  );

  sanitized = sanitized.replace(
    /-----BEGIN\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+PRIVATE\s+KEY-----/gi,
    "[REDACTED_PEM]",
  );

  sanitized = sanitized.replace(
    /-----BEGIN\s+CERTIFICATE-----[\s\S]*?-----END\s+CERTIFICATE-----/gi,
    "[REDACTED_PEM]",
  );

  if (contentType.includes("json")) {
    try {
      const parsed = JSON.parse(sanitized);

      if (typeof parsed === "object" && parsed !== null) {
        if ("token" in parsed) {
          parsed.token = "[REDACTED]";
        }

        if ("access_token" in parsed) {
          parsed.access_token = "[REDACTED]";
        }

        if ("authorization" in parsed) {
          parsed.authorization = "[REDACTED]";
        }
      }

      sanitized = JSON.stringify(parsed);
    } catch {
      // If parsing fails, continue with regex-only sanitization
    }
  }

  sanitized = sanitized.replace(
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,
    "",
  );

  sanitized = sanitized
    .replace(/[ \t]+/g, " ")
    .replace(/(\r?\n)+/g, "\n")
    .trim();

  if (sanitized.length > 1000) {
    sanitized =
      sanitized.slice(0, 1000) + " [TRUNCATED]";
  }

  return sanitized.length > 0
    ? sanitized
    : "EMPTY_RESPONSE";
}

async function readBoletaRestSubmitResponse(
  response: Response,
  requestUrl: string,
): Promise<{
  raw: string;
  contentType: string;
  responseBytes: number;
}> {
  const contentType =
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";

  const bytes = Buffer.from(
    await response.arrayBuffer(),
  );

  const responseHeaderNames = [
    ...new Set(
      [...response.headers.keys()].map((name) =>
        name.toLowerCase(),
      ),
    ),
  ].sort();

  const safeHeaderValue = (
    name: string,
  ): string | null => {
    const value = response.headers.get(name);
    if (value === null) return null;
    return sanitizeBoletaRestResponseBody(
      value,
      "text/plain",
    );
  };

  const failureDiagnostics = {
    responseHeaderNames,
    wwwAuthenticate: safeHeaderValue(
      "www-authenticate",
    ),
    host: new URL(requestUrl).hostname,
    timestamp: new Date().toISOString(),
    requestId:
      safeHeaderValue("x-request-id") ??
      safeHeaderValue("request-id"),
    correlationId:
      safeHeaderValue("x-correlation-id") ??
      safeHeaderValue("correlation-id"),
  };

  if (
    bytes.length >
      BOLETA_REST_SUBMIT_MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_SIZE_INVALID",
    );
  }

  if (bytes.length === 0 && response.status === 200) {
    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_SIZE_INVALID",
    );
  }

  let raw: string;

  try {
    raw = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    if (response.status !== 200) {
      throw new BoletaRestSubmitHttpError({
        status: response.status,
        responseText: "[INVALID_UTF8]",
        contentType,
        responseBytes: bytes.length,
        ...failureDiagnostics,
      });
    }

    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_UTF8_INVALID",
    );
  }

  if (response.status !== 200) {
    const sanitizedBody =
      sanitizeBoletaRestResponseBody(
        raw,
        contentType,
      );

    throw new BoletaRestSubmitHttpError({
      status: response.status,
      responseText: sanitizedBody,
      contentType,
      responseBytes: bytes.length,
      ...failureDiagnostics,
    });
  }

  if (contentType !== "application/json") {
    throw new Error(
      "BOLETA_REST_SUBMIT_CONTENT_TYPE_INVALID",
    );
  }

  return {
    raw,
    contentType,
    responseBytes: bytes.length,
  };
}

export async function requestBoletaRestSubmit(
  input: BoletaRestSubmitInput,
): Promise<BoletaRestSubmitResult> {
  assertBoletaRestToken(
    input.token,
  );

  assertBoletaRestFile(
    input.fileName,
    input.fileBytes,
  );

  const sender =
    splitRut(input.senderRut);

  const company =
    splitRut(input.companyRut);

  const timeoutMs =
    resolveBoletaRestSubmitTimeout(
      input.timeoutMs,
    );

  const fetchImpl =
    input.fetchImpl ??
    globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error(
      "BOLETA_REST_FETCH_UNAVAILABLE",
    );
  }

  const userAgent =
    input.userAgent ??
    BOLETA_CERTIFICATION_USER_AGENT;

  if (
    !userAgent.trim() ||
    /[\r\n]/.test(userAgent) ||
    userAgent.length > 200
  ) {
    throw new Error(
      "BOLETA_REST_USER_AGENT_INVALID",
    );
  }

  const stableBytes =
    Buffer.from(input.fileBytes);

  const arrayBuffer =
    stableBytes.buffer.slice(
      stableBytes.byteOffset,
      stableBytes.byteOffset +
        stableBytes.byteLength,
    ) as ArrayBuffer;

  const form = new FormData();

  form.append(
    "rutSender",
    sender.rut,
  );

  form.append(
    "dvSender",
    sender.dv,
  );

  form.append(
    "rutCompany",
    company.rut,
  );

  form.append(
    "dvCompany",
    company.dv,
  );

  form.append(
    "archivo",
    new Blob(
      [arrayBuffer],
      {
        type: "application/xml",
      },
    ),
    input.fileName,
  );

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  const environment = input.environment ?? "certification";
  const environmentConfig =
    assertBoletaApiEnvironmentHosts(environment);
  const submitUrl =
    input.submitUrl ??
    `${environmentConfig.uploadBaseUrl}/boleta.electronica.envio`;

  if (
    submitUrl !==
    `${environmentConfig.uploadBaseUrl}/boleta.electronica.envio`
  ) {
    throw new Error(
      "DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH",
    );
  }

  try {
    const response =
      await fetchImpl(
        submitUrl,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-store",
            Cookie:
              `TOKEN=${input.token}`,
            "User-Agent":
              userAgent,
          },
          body: form,
          redirect: "manual",
          signal: controller.signal,
        },
      );

    const parsedResponse =
      await readBoletaRestSubmitResponse(
        response,
        submitUrl,
      );

    const data =
      parseBoletaRestSubmitResponse(
        parsedResponse.raw,
      );

    const responseSha256 = createHash("sha256")
      .update(Buffer.from(parsedResponse.raw, "utf8"))
      .digest("hex");

    const sanitizedJson: Record<string, unknown> = {
      rut_emisor: data.rutEmisor,
      rut_envia: data.rutEnvia,
      trackid: data.trackId,
      fecha_recepcion: data.receptionDate,
      estado: data.status,
      file: data.fileName,
    };

    if (
      canonicalBoletaRestRut(
        data.rutEmisor,
      ) !==
        canonicalBoletaRestRut(
          input.companyRut,
        ) ||
      canonicalBoletaRestRut(
        data.rutEnvia,
      ) !==
        canonicalBoletaRestRut(
          input.senderRut,
        )
    ) {
      throw new Error(
        "BOLETA_REST_SUBMIT_RESPONSE_RUT_MISMATCH",
      );
    }

    let warning: "FILE_NAME_MISMATCH" | null = null;
    if (
      data.fileName !==
      input.fileName
    ) {
      warning = "FILE_NAME_MISMATCH";
    }

    if (
      !data.receptionDate ||
      data.receptionDate.length > 100
    ) {
      throw new Error(
        "BOLETA_REST_SUBMIT_RECEPTION_DATE_INVALID",
      );
    }

    const location =
      validateBoletaRestLocation(
        response.headers.get(
          "x-location",
        ),
        input.companyRut,
        data.trackId,
      );

    const rawRetryAfter =
      response.headers.get(
        "x-retry-after",
      );

    const retryAfterSeconds =
      parseBoletaRetryAfter(
        rawRetryAfter,
      );

    if (
      rawRetryAfter !== null &&
      retryAfterSeconds === null
    ) {
      throw new Error(
        "BOLETA_REST_SUBMIT_RETRY_AFTER_INVALID",
      );
    }

    return {
      httpStatus: response.status,
      data,
      contentType:
        parsedResponse.contentType,
      responseBytes:
        parsedResponse.responseBytes,
      responseSha256,
      location,
      retryAfterSeconds,
      warning,
      sanitizedJson,
      responseBody: parsedResponse.raw,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        "BOLETA_REST_SUBMIT_TIMEOUT",
      );
    }

    if (
      error instanceof Error &&
      error.message.startsWith(
        "BOLETA_REST_",
      )
    ) {
      throw error;
    }

    throw new Error(
      "BOLETA_REST_SUBMIT_NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }
}

export type BoletaRestStatusInput = {
  environment?: BoletaApiEnvironment;
  token: string;
  companyRut: string;
  trackId: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
};

export type BoletaRestStatusResult = {
  httpStatus: number;
  contentType: string;
  responseBytes: number;
  responseSha256: string;
  sanitizedJson: Record<string, unknown>;
  data: {
    rutEmisor: string;
    trackId: string;
    receptionDate: string;
    status: string;
    estadisticas: Array<{
      tipo: number;
      informados: number;
      aceptados: number;
      rechazados: number;
      reparos: number;
    }>;
    detalleRepRech: Array<unknown>;
  };
};

export type BoletaRestDocumentStatusInput = {
  environment: BoletaApiEnvironment;
  token: string;
  companyRut: string;
  dteType: 39 | 41;
  folio: number;
  recipientRut: string;
  amount: number;
  issueDate: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
};

export type BoletaRestDocumentStatusResult = {
  httpStatus: number;
  contentType: string;
  responseBytes: number;
  responseSha256: string;
  sanitizedJson: Record<string, unknown>;
  data: { code: string };
};

function siiIssueDate(value: string): string {
  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) return value;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("BOLETA_API_ISSUE_DATE_INVALID");
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export async function requestBoletaRestDocumentStatus(
  input: BoletaRestDocumentStatusInput,
): Promise<BoletaRestDocumentStatusResult> {
  assertBoletaRestToken(input.token);
  const url = buildBoletaDocumentStatusUrl({
    environment: input.environment,
    companyRut: input.companyRut,
    dteType: input.dteType,
    folio: input.folio,
    recipientRut: input.recipientRut,
    amount: input.amount,
    issueDate: siiIssueDate(input.issueDate),
  });
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("BOLETA_REST_FETCH_UNAVAILABLE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        Cookie: `TOKEN=${input.token}`,
        "User-Agent": input.userAgent ?? BOLETA_CERTIFICATION_USER_AGENT,
      },
      redirect: "manual",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 200) {
      throw new Error(`BOLETA_REST_DOCUMENT_STATUS_HTTP_${response.status}`);
    }
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error("BOLETA_REST_DOCUMENT_STATUS_CONTENT_TYPE_INVALID");
    }
    const raw = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("BOLETA_REST_DOCUMENT_STATUS_RESPONSE_INVALID");
    }
    const sanitized = sanitizeBoletaRestResponseBody(raw, contentType);
    let sanitizedJson: Record<string, unknown>;
    try {
      sanitizedJson = JSON.parse(sanitized) as Record<string, unknown>;
    } catch {
      sanitizedJson = { code: String(parsed.codigo ?? parsed.code ?? parsed.estado ?? "") };
    }
    return {
      httpStatus: response.status,
      contentType,
      responseBytes: Buffer.byteLength(raw, "utf8"),
      responseSha256: createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex"),
      sanitizedJson,
      data: { code: String(parsed.codigo ?? parsed.code ?? parsed.estado ?? "").toUpperCase() },
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("BOLETA_REST_DOCUMENT_STATUS_TIMEOUT");
    if (error instanceof Error && error.message.startsWith("BOLETA_REST_")) throw error;
    throw new Error("BOLETA_REST_DOCUMENT_STATUS_NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

export async function requestBoletaRestStatus(
  input: BoletaRestStatusInput,
): Promise<BoletaRestStatusResult> {
  assertBoletaRestToken(input.token);

  const environment = input.environment ?? "certification";
  const environmentConfig = assertBoletaApiEnvironmentHosts(environment);
  const apiBaseUrl = input.apiBaseUrl ?? environmentConfig.queryBaseUrl;
  if (apiBaseUrl !== environmentConfig.queryBaseUrl) {
    throw new Error("DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH");
  }
  const url = buildBoletaRestStatusUrl(input.companyRut, input.trackId, apiBaseUrl);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("BOLETA_REST_FETCH_UNAVAILABLE");
  }

  const userAgent = input.userAgent ?? BOLETA_CERTIFICATION_USER_AGENT;
  const timeoutMs = input.timeoutMs ?? 15_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        Cookie: `TOKEN=${input.token}`,
        "User-Agent": userAgent,
      },
      redirect: "manual",
      signal: controller.signal,
    });

    const rawBody = await response.text();
    const responseBytes = Buffer.byteLength(rawBody, "utf8");
    const responseSha256 = createHash("sha256")
      .update(Buffer.from(rawBody, "utf8"))
      .digest("hex");

    let rawJson: Record<string, unknown> = {};
    try {
      rawJson = JSON.parse(rawBody);
    } catch {
      rawJson = { rawText: rawBody };
    }

    const sanitizedString = sanitizeBoletaRestResponseBody(
      rawBody,
      response.headers.get("content-type") ?? "application/json",
    );
    let sanitizedJson: Record<string, unknown> = {};
    try {
      sanitizedJson = JSON.parse(sanitizedString);
    } catch {
      sanitizedJson = { rawText: sanitizedString };
    }

    const statsRaw = Array.isArray(rawJson.estadisticas)
      ? rawJson.estadisticas
      : Array.isArray(rawJson.estadistica)
      ? rawJson.estadistica
      : [];

    const estadisticas = statsRaw.map((candidate) => {
      const st =
        candidate && typeof candidate === "object"
          ? candidate as Record<string, unknown>
          : {};
      return {
        tipo: Number(st.tipo ?? st.tipo_doc ?? 39),
        informados: Number(st.informados ?? st.cantidad_informados ?? 0),
        aceptados: Number(st.aceptados ?? st.cantidad_aceptados ?? 0),
        rechazados: Number(st.rechazados ?? st.cantidad_rechazados ?? 0),
        reparos: Number(st.reparos ?? st.cantidad_reparos ?? 0),
      };
    });

    const detalleRepRech = Array.isArray(rawJson.detalle_rep_rech)
      ? rawJson.detalle_rep_rech
      : Array.isArray(rawJson.detalleRepRech)
      ? rawJson.detalleRepRech
      : [];

    return {
      httpStatus: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      responseBytes,
      responseSha256,
      sanitizedJson,
      data: {
        rutEmisor: String(rawJson.rut_emisor ?? rawJson.rutEmisor ?? input.companyRut),
        trackId: String(rawJson.trackid ?? rawJson.trackId ?? input.trackId),
        receptionDate: String(rawJson.fecha_recepcion ?? rawJson.receptionDate ?? ""),
        status: String(rawJson.estado ?? rawJson.status ?? ""),
        estadisticas,
        detalleRepRech,
      },
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("BOLETA_REST_STATUS_TIMEOUT");
    }
    if (error instanceof Error && error.message.startsWith("BOLETA_REST_")) {
      throw error;
    }
    throw new Error("BOLETA_REST_STATUS_NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}
