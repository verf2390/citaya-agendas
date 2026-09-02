import { createHash, createPublicKey, createSign, createVerify, X509Certificate } from "node:crypto";
import { SignedXml } from "xml-crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { validateExternalDteFile } from "../config/external-dte-files";
import type {
  RealXmlSigningConfig,
  RealXmlSigningPreparationResult,
  XmlSignatureStatus,
  XmlDsigBuildInput,
  XmlDsigBuildResult,
} from "../types";
import { escapeXml } from "../xml/escape-xml";

const REQUIRED_XMLDSIG_DEPENDENCY = "xml-crypto";
export const XMLDSIG_C14N_METHOD = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const XMLDSIG_RSA_SHA1_METHOD = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
export const XMLDSIG_SHA1_METHOD = "http://www.w3.org/2000/09/xmldsig#sha1";
export const XMLDSIG_TRANSFORMS = [XMLDSIG_C14N_METHOD] as const;
const C14N = XMLDSIG_C14N_METHOD;
const RSA_SHA1 = XMLDSIG_RSA_SHA1_METHOD;
const SHA1 = XMLDSIG_SHA1_METHOD;


export type XmlCanonicalizationResult =
  | { ok: true; canonicalXml: string; method: typeof XMLDSIG_C14N_METHOD }
  | { ok: false; status: "pending_real_certification" | "failed"; reason: string };

export type XmlSignatureVerificationResult = {
  attempted: boolean;
  ok: boolean;
  reason?: string;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeXmlControlled(xml: string): XmlCanonicalizationResult {
  if (!xml.trim()) {
    return { ok: false, status: "failed", reason: "XML vacio para canonicalizacion." };
  }

  const check = spawnSync("xmllint", ["--version"], { encoding: "utf8" });
  if (check.error || check.status !== 0) {
    return {
      ok: false,
      status: "pending_real_certification",
      reason: "xmllint con soporte C14N no esta disponible; no se canonicaliza manualmente.",
    };
  }

  const dir = mkdtempSync(join(tmpdir(), "citaya-dte-c14n-"));
  const inputPath = join(dir, "input.xml");
  try {
    writeFileSync(inputPath, xml, "utf8");
    const result = spawnSync("xmllint", ["--c14n", inputPath], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0 || !result.stdout.trim()) {
      const detail = (result.stderr || result.stdout || "").trim().split(/\r?\n/)[0];
      return {
        ok: false,
        status: "failed",
        reason: detail ? `xmllint no pudo canonicalizar el XML proporcionado: ${detail}` : "xmllint no pudo canonicalizar el XML proporcionado.",
      };
    }
    return { ok: true, canonicalXml: result.stdout, method: XMLDSIG_C14N_METHOD };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function verifyXmlSignatureControlled(input: {
  signedInfoXml: string;
  signatureValue: string;
  certificatePem: string;
  expectedDigestValue?: string | null;
  canonicalizedReferenceXml?: string | null;
}): XmlSignatureVerificationResult {
  const canonicalSignedInfo = canonicalizeXmlControlled(input.signedInfoXml);
  if (!canonicalSignedInfo.ok) {
    return { attempted: true, ok: false, reason: canonicalSignedInfo.reason };
  }

  if (input.expectedDigestValue && input.canonicalizedReferenceXml) {
    const digest = sha1Base64(input.canonicalizedReferenceXml);
    if (digest !== input.expectedDigestValue) {
      return { attempted: true, ok: false, reason: "DigestValue no coincide con el nodo canonicalizado." };
    }
  }

  try {
    const verifier = createVerify("RSA-SHA1");
    verifier.update(canonicalSignedInfo.canonicalXml, "utf8");
    const ok = verifier.verify(input.certificatePem, input.signatureValue, "base64");
    return {
      attempted: true,
      ok,
      reason: ok ? undefined : "SignatureValue no verifica con el certificado publico.",
    };
  } catch {
    return {
      attempted: true,
      ok: false,
      reason: "No se pudo verificar XMLDSig con el certificado externo.",
    };
  }
}

function envValue(name: string): string {
  return String(process.env[name] ?? "").trim();
}

export function getRealXmlSigningConfigFromEnv(
  tenantId: string,
  signatureTarget: string,
): RealXmlSigningConfig {
  const mode = envValue("DTE_SIGNING_MODE") || "lab";

  return {
    tenantId,
    signatureTarget,
    mode:
      mode === "certification" || mode === "production" || mode === "lab"
        ? mode
        : "lab",
    certificatePath: envValue("DTE_CERT_PATH") || null,
    certificatePassword: envValue("DTE_CERT_PASSWORD") || null,
    privateKeyPath: envValue("DTE_PRIVATE_KEY_PATH") || null,
    publicCertificatePath:
      envValue("DTE_PUBLIC_CERT_PATH") || envValue("DTE_CERT_PATH") || null,
  };
}

export function prepareRealXmlSigning(
  xml: string,
  config: RealXmlSigningConfig,
): RealXmlSigningPreparationResult {
  const missing: string[] = [];
  const warnings = [
    "Firma XML real PENDIENTE: requiere canonicalizacion, digest, firma RSA e insercion XMLDSig validada contra xmldsignature_v10.xsd.",
    `Dependencia recomendada no instalada automaticamente: ${REQUIRED_XMLDSIG_DEPENDENCY}.`,
    "No usar certificados productivos hasta validar en ambiente de certificacion SII.",
  ];

  if (!xml.trim()) missing.push("xml");
  if (!config.tenantId.trim()) missing.push("tenantId");
  if (!config.signatureTarget.trim()) missing.push("signatureTarget");
  if (!config.certificatePath) missing.push("DTE_CERT_PATH");
  if (!config.privateKeyPath) missing.push("DTE_PRIVATE_KEY_PATH");
  if (!config.publicCertificatePath) missing.push("DTE_PUBLIC_CERT_PATH");

  const certValidation = validateExternalDteFile({
    envName: "DTE_CERT_PATH",
    pathValue: config.certificatePath,
    allowedExtensions: [".pem", ".crt", ".cer"],
  });
  const keyValidation = validateExternalDteFile({
    envName: "DTE_PRIVATE_KEY_PATH",
    pathValue: config.privateKeyPath,
    allowedExtensions: [".pem", ".key"],
  });
  const publicCertValidation = validateExternalDteFile({
    envName: "DTE_PUBLIC_CERT_PATH",
    pathValue: config.publicCertificatePath,
    allowedExtensions: [".pem", ".crt", ".cer"],
  });
  for (const [name, validation] of [
    ["DTE_CERT_PATH", certValidation],
    ["DTE_PRIVATE_KEY_PATH", keyValidation],
    ["DTE_PUBLIC_CERT_PATH", publicCertValidation],
  ] as const) {
    if (!validation.ok && validation.status !== "pending_config") {
      missing.push(`${name}:${validation.status}`);
    }
  }
  const unsafe = [certValidation, keyValidation, publicCertValidation].some(
    (item) => item.status === "unsafe_repo_path",
  );
  const unsupported = [certValidation, keyValidation, publicCertValidation].some(
    (item) => item.status === "unsupported_certificate_format",
  );
  const failed = [certValidation, keyValidation, publicCertValidation].some(
    (item) => item.status === "failed",
  );

  return {
    ok: false,
    status: unsafe
      ? "unsafe_repo_path"
      : unsupported
        ? "unsupported_certificate_format"
        : failed
          ? "failed"
          : missing.length > 0
            ? "missing_secret"
            : "pending_dependency",
    mode: config.mode,
    isProductionValid: false,
    missing,
    warnings,
  };
}

export async function signXmlRealControlled(): Promise<never> {
  throw new Error(
    [
      "Real XML signing is blocked in this build.",
      "Implement controlled certificate loading, private key extraction, canonicalization, digest, XMLDSig insertion and XSD validation before enabling it.",
      "Required env vars: DTE_CERT_PATH, DTE_CERT_PASSWORD, DTE_PRIVATE_KEY_PATH, DTE_PUBLIC_CERT_PATH, DTE_SIGNING_MODE.",
    ].join(" "),
  );
}

export function wrapBase64Lines(value: string): string {
  const compact = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new Error("Base64 XMLDSig invalido");
  return compact.match(/.{1,76}/g)?.join("\n") ?? "";
}

function sha1Base64(value: string): string {
  return createHash("sha1").update(value).digest("base64");
}

export type FinalContextXmlDsigResult = {
  signedXml: string;
  signatureXml: string;
};
function wrapGeneratedSignatureBase64(xml: string): string {
  return xml.replace(/<(SignatureValue|X509Certificate)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g, (_match, tag, value) => `<${tag}>${wrapBase64Lines(value)}</${tag}>`);
}
export function signXmlInFinalContextControlled(input: { xml: string; referenceId: string; insertAfterXPath: string }, config: RealXmlSigningConfig): FinalContextXmlDsigResult {
  const preparation = prepareRealXmlSigning(input.xml, config);
  if (preparation.missing.length > 0 || preparation.status === "unsafe_repo_path" || preparation.status === "failed") throw new Error("XMLDSig final-context requires controlled external signing material");
  if ((config.mode !== "certification" && config.mode !== "production") || !config.privateKeyPath || !config.publicCertificatePath) throw new Error("XMLDSig final-context requires controlled signing configuration");
  const privateKey = readFileSync(config.privateKeyPath, "utf8");
  const certificate = readFileSync(config.publicCertificatePath, "utf8");
  const keyInfo = extractRsaKeyInfo(certificate);
  const signer = new SignedXml({
    privateKey,
    publicCert: certificate,
    canonicalizationAlgorithm: C14N,
    signatureAlgorithm: RSA_SHA1,
    getKeyInfoContent: () => `<KeyValue><RSAKeyValue><Modulus>${keyInfo.modulus}</Modulus><Exponent>${keyInfo.exponent}</Exponent></RSAKeyValue></KeyValue><X509Data><X509Certificate>${keyInfo.x509Certificate}</X509Certificate></X509Data>`,
  });
  signer.addReference({ xpath: `//*[@ID='${input.referenceId}']`, transforms: [C14N], digestAlgorithm: SHA1, uri: `#${input.referenceId}` });
  signer.computeSignature(input.xml, { location: { reference: input.insertAfterXPath, action: "after" }, existingPrefixes: { ds: "http://www.w3.org/2000/09/xmldsig#" } });
  const signedXml = wrapGeneratedSignatureBase64(signer.getSignedXml());
  const signatures = [...signedXml.matchAll(/<Signature\b[^>]*>[\s\S]*?<\/Signature>/g)];
  const signatureXml = signatures.find((match) => match[0].includes(`<Reference URI="#${input.referenceId}"`))?.[0];
  if (!signatureXml) throw new Error("XMLDSig final-context signature insertion failed");
  return { signedXml, signatureXml };
}

function stripPem(value: string): string {
  return value
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
}

function base64UrlToBase64(value: string): string {
  return Buffer.from(value, "base64url").toString("base64");
}

function extractRsaKeyInfo(certificate: string): {
  modulus: string;
  exponent: string;
  x509Certificate: string;
} {
  try {
    const x509 = new X509Certificate(certificate);
    const jwk = x509.publicKey.export({ format: "jwk" }) as { kty?: string; n?: string; e?: string };
    if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
      throw new Error("Certificado XMLDSig no contiene public key RSA.");
    }
    return {
      modulus: base64UrlToBase64(jwk.n),
      exponent: base64UrlToBase64(jwk.e),
      x509Certificate: x509.raw.toString("base64"),
    };
  } catch {
    const publicKey = createPublicKey(certificate);
    const jwk = publicKey.export({ format: "jwk" }) as { kty?: string; n?: string; e?: string };
    if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
      throw new Error("XMLDSig certification requiere certificado/public key RSA valida.");
    }
    return {
      modulus: base64UrlToBase64(jwk.n),
      exponent: base64UrlToBase64(jwk.e),
      x509Certificate: stripPem(certificate),
    };
  }
}

export function getXmlDsigControlledMetadata(
  status: XmlSignatureStatus = "pending_real_certification",
) {
  return {
    signed: status === "ready_controlled" || status === "verified_controlled",
    xmlSignatureStatus: status,
    canonicalizationMethod: C14N,
    digestMethod: SHA1,
    signatureMethod: RSA_SHA1,
    transforms: [...XMLDSIG_TRANSFORMS],
  };
}

export function buildXmlDsigControlled(
  input: XmlDsigBuildInput,
  config: RealXmlSigningConfig,
): XmlDsigBuildResult {
  const preparation = prepareRealXmlSigning(input.signedXmlFragment, config);
  if (preparation.missing.length > 0) {
    const status = preparation.status === "unsafe_repo_path"
      ? "unsafe_repo_path"
      : preparation.status === "unsupported_certificate_format"
        ? "unsupported_certificate_format"
        : preparation.status === "failed"
          ? "failed"
          : "missing_external_file";
    throw new Error(
      `XMLDSig certification requires external secrets. status=${status} missing=${preparation.missing.join(", ")}`,
    );
  }

  if (input.mode !== "certification" || config.mode !== "certification") {
    throw new Error("XMLDSig real controlado solo esta habilitado en modo certification");
  }

  if (!config.privateKeyPath || !config.publicCertificatePath) {
    throw new Error("XMLDSig certification requiere DTE_PRIVATE_KEY_PATH y DTE_PUBLIC_CERT_PATH");
  }

  if (preparation.status === "unsafe_repo_path" || preparation.status === "failed") {
    throw new Error(
      `XMLDSig certification external file validation failed: ${preparation.status}`,
    );
  }

  const privateKey = readFileSync(config.privateKeyPath, "utf8");
  const certificate = readFileSync(config.publicCertificatePath, "utf8");
  const canonicalReference = canonicalizeXmlControlled(input.signedXmlFragment);
  if (!canonicalReference.ok) {
    return {
      signatureXml: "",
      mode: "certification",
      isProductionValid: false,
      signed: false,
      xmlSignatureStatus: canonicalReference.status,
      canonicalizationMethod: C14N,
      digestMethod: SHA1,
      signatureMethod: RSA_SHA1,
      transforms: [...XMLDSIG_TRANSFORMS],
      referenceUri: input.referenceUri,
      reason: canonicalReference.reason,
      verification: { attempted: false, ok: false, reason: "No se firmo porque canonicalizacion fallo." },
      warnings: [canonicalReference.reason],
    };
  }
  const digest = sha1Base64(canonicalReference.canonicalXml);
  const signedInfo = [
    '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">',
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>`,
    `<SignatureMethod Algorithm="${RSA_SHA1}"></SignatureMethod>`,
    `<Reference URI="#${escapeXml(input.referenceUri)}">`,
    "<Transforms>",
    `<Transform Algorithm="${C14N}"></Transform>`,
    "</Transforms>",
    `<DigestMethod Algorithm="${SHA1}"></DigestMethod>`,
    `<DigestValue>${digest}</DigestValue>`,
    "</Reference>",
    "</SignedInfo>",
  ].join("\n");
  const canonicalSignedInfo = canonicalizeXmlControlled(signedInfo);
  if (!canonicalSignedInfo.ok) {
    return {
      signatureXml: "",
      mode: "certification",
      isProductionValid: false,
      signed: false,
      xmlSignatureStatus: canonicalSignedInfo.status,
      canonicalizationMethod: C14N,
      digestMethod: SHA1,
      signatureMethod: RSA_SHA1,
      transforms: [...XMLDSIG_TRANSFORMS],
      referenceUri: input.referenceUri,
      reason: canonicalSignedInfo.reason,
      verification: { attempted: false, ok: false, reason: "No se firmo porque canonicalizacion de SignedInfo fallo." },
      warnings: [canonicalSignedInfo.reason],
    };
  }
  let signatureValue: string;
  try {
    const signer = createSign("RSA-SHA1");
    signer.update(canonicalSignedInfo.canonicalXml, "utf8");
    signatureValue = signer.sign(privateKey, "base64");
  } catch {
    throw new Error("XMLDSig certification failed with external private key; revisar formato PEM y password/PFX no soportado.");
  }
  const verification = verifyXmlSignatureControlled({
    signedInfoXml: signedInfo,
    signatureValue,
    certificatePem: certificate,
    expectedDigestValue: digest,
    canonicalizedReferenceXml: canonicalReference.canonicalXml,
  });
  const keyInfo = extractRsaKeyInfo(certificate);
  const xmlSignatureStatus: XmlSignatureStatus = verification.ok
    ? "verified_controlled"
    : "verification_failed";

  return {
    mode: "certification",
    isProductionValid: false,
    signed: true,
    xmlSignatureStatus,
    canonicalizationMethod: C14N,
    digestMethod: SHA1,
    signatureMethod: RSA_SHA1,
    transforms: [...XMLDSIG_TRANSFORMS],
    referenceUri: input.referenceUri,
    reason: verification.ok
      ? "Firma criptografica controlada verificada localmente; falta validar insercion/XSD/SII certification."
      : (verification.reason ?? "Verificacion XMLDSig controlada fallo."),
    digestValueSha256: sha256Hex(digest),
    signatureValueSha256: sha256Hex(signatureValue),
    verification,
    warnings: [
      `XMLDSig status=${xmlSignatureStatus} verification=${verification.ok ? "ok" : "failed"}.`,
      "XMLDSig generado con Node crypto + xmllint C14N en modo certification controlado.",
      "XMLDSig controlado no equivale a aprobacion SII ni habilita produccion.",
    ],
    signatureXml: [
      '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">',
      signedInfo,
      `<SignatureValue>${wrapBase64Lines(signatureValue)}</SignatureValue>`,
      "<KeyInfo>",
      "<KeyValue>",
      "<RSAKeyValue>",
      `<Modulus>${keyInfo.modulus}</Modulus>`,
      `<Exponent>${keyInfo.exponent}</Exponent>`,
      "</RSAKeyValue>",
      "</KeyValue>",
      "<X509Data>",
      `<X509Certificate>${wrapBase64Lines(keyInfo.x509Certificate)}</X509Certificate>`,
      "</X509Data>",
      "</KeyInfo>",
      "</Signature>",
    ].join("\n"),
  };
}
