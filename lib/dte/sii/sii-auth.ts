import { SignedXml } from "xml-crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { validateRut } from "../rut";
import { fingerprintToken } from "../persistence/dte-redaction";
import {
  SII_ERROR_CODES,
  SiiCertificationError,
  assertCertificationEnvironment,
  redactToken,
} from "./sii-errors";
import type {
  SiiCertificationConfig,
  SiiSeedResult,
  SiiSignedSeedResult,
  SiiTokenResult,
} from "./sii-types";

export const SII_CERTIFICATION_SEED_URL = "https://maullin.sii.cl/DTEWS/CrSeed.jws";
export const SII_CERTIFICATION_SEED_WSDL_URL = `${SII_CERTIFICATION_SEED_URL}?WSDL`;
export const SII_CERTIFICATION_TOKEN_URL = "https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws";
export const SII_CERTIFICATION_TOKEN_WSDL_URL = `${SII_CERTIFICATION_TOKEN_URL}?WSDL`;

export const XMLDSIG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const XMLDSIG_RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
export const XMLDSIG_ENVELOPED_SIGNATURE = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
export const XMLDSIG_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

export type ParsedSiiSeedSoapResponse = {
  estado: string | null;
  glosa: string | null;
  semilla: string | null;
};

export type ParsedSiiTokenSoapResponse = {
  estado: string | null;
  glosa: string | null;
  token: string | null;
};

type XmlNode = {
  nodeType?: number;
  localName?: string | null;
  nodeName?: string | null;
  textContent?: string | null;
  childNodes?: ArrayLike<unknown>;
};

function now(): string {
  return new Date().toISOString();
}

function withTimeout(config: SiiCertificationConfig, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    signal: AbortSignal.timeout(config.timeoutMs || 30_000),
  };
}

function requireEndpoint(value: string, field: string): void {
  if (!value.trim()) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.ENDPOINT_MISSING,
      `Falta endpoint SII certification: ${field}`,
      field,
    );
  }
  if (value.includes("?WSDL")) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      `${field} debe usar endpoint operativo, no WSDL.`,
      field,
    );
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseXml(xml: string): XmlNode {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const parseError = firstElementByLocalName(doc, "parsererror");
  if (parseError) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_RESPONSE,
      "Respuesta XML SII invalida o no parseable.",
    );
  }
  return doc;
}

function firstElementByLocalName(node: XmlNode, localName: string): XmlNode | null {
  if (node.nodeType === 1) {
    if (node.localName === localName || node.nodeName === localName) return node;
  }
  const childNodes = node.childNodes ?? [];
  for (let index = 0; index < childNodes.length; index += 1) {
    const match = firstElementByLocalName(childNodes[index] as XmlNode, localName);
    if (match) return match;
  }
  return null;
}

function textByLocalName(node: XmlNode, localName: string): string | null {
  return firstElementByLocalName(node, localName)?.textContent?.trim() ?? null;
}

function parsePossiblyNestedXml(text: string): XmlNode | null {
  const trimmed = text.trim();
  if (!trimmed || !trimmed.includes("<")) return null;
  try {
    return parseXml(trimmed);
  } catch {
    return null;
  }
}

function collectResponseDocuments(soapXml: string, returnElementNames: string[]): XmlNode[] {
  const soapDoc = parseXml(soapXml);
  const documents = [soapDoc];

  for (const name of returnElementNames) {
    const value = textByLocalName(soapDoc, name);
    const nested = value ? parsePossiblyNestedXml(value) : null;
    if (nested) documents.unshift(nested);
  }

  return documents;
}

function statusIsOk(estado: string | null): boolean {
  return estado === "00";
}

function base64UrlToBase64(value: string): string {
  return Buffer.from(value, "base64url").toString("base64");
}

export function getX509CertificateDerBase64(certificatePem: string): string {
  return new X509Certificate(certificatePem).raw.toString("base64");
}

export function getCertificateRsaKeyValue(certificatePem: string): {
  modulus: string;
  exponent: string;
} {
  const publicKey = new X509Certificate(certificatePem).publicKey;
  const jwk = publicKey.export({ format: "jwk" }) as { kty?: string; n?: string; e?: string };
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.CERTIFICATE_MISSING,
      "Certificado externo no contiene public key RSA valida para KeyInfo SII.",
      "DTE_CERT_PATH",
    );
  }
  return {
    modulus: base64UrlToBase64(jwk.n),
    exponent: base64UrlToBase64(jwk.e),
  };
}

export function buildSiiSeedKeyInfoContent(certificatePem: string): string {
  const certificateDerBase64 = getX509CertificateDerBase64(certificatePem);
  const rsa = getCertificateRsaKeyValue(certificatePem);
  return [
    "<KeyValue>",
    "<RSAKeyValue>",
    `<Modulus>${rsa.modulus}</Modulus>`,
    `<Exponent>${rsa.exponent}</Exponent>`,
    "</RSAKeyValue>",
    "</KeyValue>",
    "<X509Data>",
    `<X509Certificate>${certificateDerBase64}</X509Certificate>`,
    "</X509Data>",
  ].join("");
}

function requireExternalPem(pathValue: string | null | undefined, field: string): string {
  if (!pathValue || !existsSync(pathValue)) {
    throw new SiiCertificationError(
      field === "DTE_CERT_PATH" ? SII_ERROR_CODES.CERTIFICATE_MISSING : SII_ERROR_CODES.PRIVATE_KEY_MISSING,
      field === "DTE_CERT_PATH"
        ? "Falta certificado real externo para seed/token SII."
        : "Falta private key real externa para firmar seed SII.",
      field,
    );
  }
  return readFileSync(pathValue, "utf8");
}

export function buildGetSeedSoapEnvelope(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:def="http://DefaultNamespace">',
    "  <soapenv:Header/>",
    "  <soapenv:Body>",
    "    <def:getSeed/>",
    "  </soapenv:Body>",
    "</soapenv:Envelope>",
  ].join("");
}

export function buildGetTokenXml(seed: string): string {
  if (!seed.trim()) {
    throw new SiiCertificationError(SII_ERROR_CODES.INVALID_REQUEST, "Seed SII vacio.", "seed");
  }

  return [
    '<?xml version="1.0"?>',
    "<getToken>",
    "  <item>",
    `    <Semilla>${xmlEscape(seed)}</Semilla>`,
    "  </item>",
    "</getToken>",
  ].join("\n");
}

export function buildGetTokenSoapEnvelope(signedXml: string): string {
  if (!signedXml.trim()) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "XML firmado seed vacio.",
      "signedXml",
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:def="http://DefaultNamespace">',
    "  <soapenv:Header/>",
    "  <soapenv:Body>",
    "    <def:getToken>",
    `      <def:pszXml>${xmlEscape(signedXml)}</def:pszXml>`,
    "    </def:getToken>",
    "  </soapenv:Body>",
    "</soapenv:Envelope>",
  ].join("");
}

export function parseSeedSoapResponse(soapXml: string): ParsedSiiSeedSoapResponse {
  const documents = collectResponseDocuments(soapXml, ["getSeedReturn", "return"]);
  for (const doc of documents) {
    const semilla = textByLocalName(doc, "SEMILLA") ?? textByLocalName(doc, "Semilla");
    const estado = textByLocalName(doc, "ESTADO") ?? textByLocalName(doc, "Estado");
    const glosa = textByLocalName(doc, "GLOSA") ?? textByLocalName(doc, "Glosa");
    if (semilla || estado || glosa) return { estado, glosa, semilla };
  }
  return { estado: null, glosa: null, semilla: null };
}

export function parseTokenSoapResponse(soapXml: string): ParsedSiiTokenSoapResponse {
  const documents = collectResponseDocuments(soapXml, ["getTokenReturn", "return"]);
  for (const doc of documents) {
    const token = textByLocalName(doc, "TOKEN") ?? textByLocalName(doc, "Token");
    const estado = textByLocalName(doc, "ESTADO") ?? textByLocalName(doc, "Estado");
    const glosa = textByLocalName(doc, "GLOSA") ?? textByLocalName(doc, "Glosa");
    if (token || estado || glosa) return { estado, glosa, token };
  }
  return { estado: null, glosa: null, token: null };
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
  if (!config.rutEmpresa || !validateRut(config.rutEmpresa)) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "RUT empresa SII invalido o no configurado.",
      "SII_RUT_EMPRESA",
    );
  }
  if (!config.rutUsuario || !validateRut(config.rutUsuario)) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "RUT usuario SII invalido o no configurado.",
      "SII_RUT_USUARIO",
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
      estado: null,
      glosa: null,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    config.seedUrl,
    withTimeout(config, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=utf-8",
        soapaction: "",
      },
      body: buildGetSeedSoapEnvelope(),
    }),
  );
  const text = await response.text();
  const parsed = parseSeedSoapResponse(text);

  if (!response.ok || !statusIsOk(parsed.estado) || !parsed.semilla) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_RESPONSE,
      `Respuesta seed SII invalida status=${response.status} estado=${parsed.estado ?? "missing"} glosa=${parsed.glosa ?? "sin_glosa"}; no contiene SEMILLA valida.`,
    );
  }

  return {
    ok: true,
    seed: parsed.semilla,
    estado: parsed.estado,
    glosa: parsed.glosa,
    status: "ready",
    message: "Seed SII obtenido desde ambiente certification.",
    requestedAt: now(),
    environment: "certification",
  };
}

export function signSeed(
  seed: string,
  config: SiiCertificationConfig,
  options: { privateKeyPem?: string | null; certificatePem?: string | null } = {},
): SiiSignedSeedResult {
  assertCertificationEnvironment(config.environment);
  const privateKeyPem = options.privateKeyPem ?? requireExternalPem(config.privateKeyPath, "DTE_PRIVATE_KEY_PATH");
  const certificatePem = options.certificatePem ?? requireExternalPem(config.certPath, "DTE_CERT_PATH");
  const keyInfoContent = buildSiiSeedKeyInfoContent(certificatePem);

  const xml = buildGetTokenXml(seed);
  const signature = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: XMLDSIG_RSA_SHA1,
    canonicalizationAlgorithm: XMLDSIG_C14N,
    getKeyInfoContent: () => keyInfoContent,
  });
  signature.addReference({
    xpath: "//*[local-name(.)='getToken']",
    transforms: [XMLDSIG_ENVELOPED_SIGNATURE],
    digestAlgorithm: XMLDSIG_SHA1,
  });
  signature.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='getToken']", action: "append" },
  });
  const signedXml = signature.getSignedXml();

  return {
    ok: true,
    signedSeed: signedXml,
    signedXml,
    status: "ready",
    message: "Seed firmado como XMLDSig enveloped para getToken SII certification.",
    signedAt: now(),
    environment: "certification",
  };
}

export function verifySignedSeedXml(signedXml: string, certificatePem: string): boolean {
  const doc = parseXml(signedXml);
  const signatureNode = firstElementByLocalName(doc, "Signature");
  if (!signatureNode) return false;
  const verifier = new SignedXml({ publicCert: certificatePem });
  verifier.loadSignature(signatureNode as never);
  return verifier.checkSignature(signedXml);
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
      "XML seed firmado vacio.",
      "signedXml",
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
      tokenFingerprint: null,
      estado: null,
      glosa: null,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    config.tokenUrl,
    withTimeout(config, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=utf-8",
        soapaction: "",
      },
      body: buildGetTokenSoapEnvelope(signedSeed),
    }),
  );
  const text = await response.text();
  const parsed = parseTokenSoapResponse(text);

  if (!response.ok || !statusIsOk(parsed.estado) || !parsed.token) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_RESPONSE,
      `Respuesta token SII invalida status=${response.status} estado=${parsed.estado ?? "missing"} glosa=${parsed.glosa ?? "sin_glosa"}; no contiene TOKEN valido.`,
    );
  }

  return {
    ok: true,
    token: parsed.token,
    redactedToken: redactToken(parsed.token),
    tokenFingerprint: fingerprintToken(parsed.token),
    estado: parsed.estado,
    glosa: parsed.glosa,
    status: "ready",
    message: "Token SII obtenido y fingerprint generado para trazabilidad.",
    requestedAt: now(),
    environment: "certification",
  };
}

export function serializeXmlNode(node: XmlNode): string {
  return new XMLSerializer().serializeToString(node as never);
}
