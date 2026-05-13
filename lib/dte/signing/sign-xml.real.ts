import { existsSync } from "node:fs";

import type {
  RealXmlSigningConfig,
  RealXmlSigningPreparationResult,
} from "../types";

const REQUIRED_XMLDSIG_DEPENDENCY = "xml-crypto";

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
    publicCertificatePath: envValue("DTE_PUBLIC_CERT_PATH") || null,
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
  if (!config.certificatePassword) missing.push("DTE_CERT_PASSWORD");
  if (!config.privateKeyPath) missing.push("DTE_PRIVATE_KEY_PATH");
  if (!config.publicCertificatePath) missing.push("DTE_PUBLIC_CERT_PATH");

  if (config.certificatePath && !existsSync(config.certificatePath)) {
    missing.push("DTE_CERT_PATH:file_not_found");
  }
  if (config.privateKeyPath && !existsSync(config.privateKeyPath)) {
    missing.push("DTE_PRIVATE_KEY_PATH:file_not_found");
  }
  if (config.publicCertificatePath && !existsSync(config.publicCertificatePath)) {
    missing.push("DTE_PUBLIC_CERT_PATH:file_not_found");
  }

  return {
    ok: false,
    status: missing.length > 0 ? "missing_secret" : "pending_dependency",
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
