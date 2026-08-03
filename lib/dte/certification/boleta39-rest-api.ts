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

export const BOLETA_CERTIFICATION_API_BASE =
  "https://apicert.sii.cl/recursos/v1";

export const BOLETA_CERTIFICATION_SEED_URL =
  `${BOLETA_CERTIFICATION_API_BASE}/boleta.electronica.semilla`;

export const BOLETA_CERTIFICATION_TOKEN_URL =
  `${BOLETA_CERTIFICATION_API_BASE}/boleta.electronica.token`;

export const BOLETA_CERTIFICATION_SUBMIT_URL =
  "https://pangal.sii.cl/recursos/v1/boleta.electronica.envio";

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

function splitRut(value: string): {
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

export function buildBoletaRestStatusUrl(
  companyRut: string,
  trackId: string,
): string {
  const company = splitRut(companyRut);

  if (!/^[0-9]{1,15}$/.test(trackId)) {
    throw new Error(
      "BOLETA_REST_TRACK_ID_INVALID",
    );
  }

  return (
    `${BOLETA_CERTIFICATION_API_BASE}` +
    "/boleta.electronica.envio/" +
    `${company.rut}-${company.dv}-${trackId}`
  );
}

export type BoletaRestHttpOptions = {
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
  if (
    url !== BOLETA_CERTIFICATION_SEED_URL &&
    url !== BOLETA_CERTIFICATION_TOKEN_URL
  ) {
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
  options: BoletaRestHttpOptions = {},
): Promise<
  BoletaRestHttpResult<BoletaRestSeedResponse>
> {
  const response =
    await performBoletaRestXmlRequest({
      operation: "seed",
      url: BOLETA_CERTIFICATION_SEED_URL,
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
  options: BoletaRestHttpOptions = {},
): Promise<
  BoletaRestHttpResult<BoletaRestTokenResponse>
> {
  assertSignedTokenRequestXml(
    signedXml,
  );

  const response =
    await performBoletaRestXmlRequest({
      operation: "token",
      url: BOLETA_CERTIFICATION_TOKEN_URL,
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
  token: string;
  senderRut: string;
  companyRut: string;
  fileName: string;
  fileBytes: Uint8Array;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
};

export type BoletaRestSubmitResult = {
  data: BoletaRestSubmitResponse;
  contentType: string;
  responseBytes: number;
  location: string | null;
  retryAfterSeconds: number | null;
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

async function readBoletaRestSubmitResponse(
  response: Response,
): Promise<{
  raw: string;
  contentType: string;
  responseBytes: number;
}> {
  if (response.status !== 200) {
    throw new Error(
      `BOLETA_REST_SUBMIT_HTTP_${response.status}`,
    );
  }

  const contentType =
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";

  if (contentType !== "application/json") {
    throw new Error(
      "BOLETA_REST_SUBMIT_CONTENT_TYPE_INVALID",
    );
  }

  const bytes = Buffer.from(
    await response.arrayBuffer(),
  );

  if (
    bytes.length === 0 ||
    bytes.length >
      BOLETA_REST_SUBMIT_MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_SIZE_INVALID",
    );
  }

  let raw: string;

  try {
    raw = new TextDecoder(
      "utf-8",
      {
        fatal: true,
      },
    ).decode(bytes);
  } catch {
    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_UTF8_INVALID",
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

  try {
    const response =
      await fetchImpl(
        BOLETA_CERTIFICATION_SUBMIT_URL,
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
      );

    const data =
      parseBoletaRestSubmitResponse(
        parsedResponse.raw,
      );

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

    if (
      data.fileName !==
      input.fileName
    ) {
      throw new Error(
        "BOLETA_REST_SUBMIT_RESPONSE_FILENAME_MISMATCH",
      );
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
      data,
      contentType:
        parsedResponse.contentType,
      responseBytes:
        parsedResponse.responseBytes,
      location,
      retryAfterSeconds,
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
