import { createHash, createSign } from "node:crypto";
import { readFileSync } from "node:fs";

import { validateExternalDteFile } from "../config/external-dte-files";
import type {
  RealXmlSigningConfig,
  RealXmlSigningPreparationResult,
  XmlDsigBuildInput,
  XmlDsigBuildResult,
} from "../types";
import { escapeXml } from "../xml/escape-xml";

const REQUIRED_XMLDSIG_DEPENDENCY = "xml-crypto";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

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
  const failed = [certValidation, keyValidation, publicCertValidation].some(
    (item) => item.status === "failed",
  );

  return {
    ok: false,
    status: unsafe
      ? "unsafe_repo_path"
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

function sha1Base64(value: string): string {
  return createHash("sha1").update(value).digest("base64");
}

function stripPem(value: string): string {
  return value
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

export function buildXmlDsigControlled(
  input: XmlDsigBuildInput,
  config: RealXmlSigningConfig,
): XmlDsigBuildResult {
  const preparation = prepareRealXmlSigning(input.signedXmlFragment, config);
  if (preparation.missing.length > 0) {
    throw new Error(
      `XMLDSig certification requires external secrets. Missing: ${preparation.missing.join(", ")}`,
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
  const digest = sha1Base64(input.signedXmlFragment);
  const signedInfo = [
    "<SignedInfo>",
    `  <CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>`,
    `  <SignatureMethod Algorithm="${RSA_SHA1}"></SignatureMethod>`,
    `  <Reference URI="#${escapeXml(input.referenceUri)}">`,
    "    <Transforms>",
    `      <Transform Algorithm="${C14N}"></Transform>`,
    "    </Transforms>",
    `    <DigestMethod Algorithm="${SHA1}"></DigestMethod>`,
    `    <DigestValue>${digest}</DigestValue>`,
    "  </Reference>",
    "</SignedInfo>",
  ].join("\n");
  let signatureValue: string;
  try {
    const signer = createSign("RSA-SHA1");
    signer.update(signedInfo, "utf8");
    signatureValue = signer.sign(privateKey, "base64");
  } catch {
    throw new Error("XMLDSig certification failed with external private key; revisar formato PEM y password/PFX no soportado.");
  }

  return {
    mode: "certification",
    isProductionValid: false,
    warnings: [
      "XMLDSig generado con Node crypto en modo certification controlado.",
      "Canonicalizacion XML real debe validarse contra SII; esta ruta no se marca como valida SII.",
    ],
    signatureXml: [
      '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">',
      signedInfo
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
      `  <SignatureValue>${signatureValue}</SignatureValue>`,
      "  <KeyInfo>",
      "    <KeyValue>",
      "      <RSAKeyValue>",
      "        <Modulus>AA==</Modulus>",
      "        <Exponent>AQAB</Exponent>",
      "      </RSAKeyValue>",
      "    </KeyValue>",
      "    <X509Data>",
      `      <X509Certificate>${stripPem(certificate)}</X509Certificate>`,
      "    </X509Data>",
      "  </KeyInfo>",
      "</Signature>",
    ].join("\n"),
  };
}
