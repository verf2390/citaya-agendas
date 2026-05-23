export const runtime = "nodejs";

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { validateExternalDteFile } from "@/lib/dte/config/external-dte-files";
import { buildDteCertificationReadiness } from "@/lib/dte/config/validate-dte-config";
import { checkDteReadiness } from "@/lib/dte/readiness/check-dte-readiness";
import {
  getDtePersistenceBackend,
  getDteRepository,
} from "@/lib/dte/persistence/get-dte-repository";
import { DTE_SUPABASE_PERSISTENCE_NOT_READY } from "@/lib/dte/persistence/supabase-dte-repository";
import { NextResponse } from "next/server";

type ArtifactStatus = {
  fileName: string;
  exists: boolean;
  sizeBytes: number | null;
  updatedAt: string | null;
  sha256: string | null;
};

type MetadataSummary = {
  exists: boolean;
  fileName: string;
  updatedAt: string | null;
  mode: string | null;
  folio: number | null;
  documentType: string | null;
  xsdValid: boolean | null;
  xmlSignatureStatus: string | null;
  verificationOk: boolean | null;
  siiContact: boolean | null;
  trackIdSimulated: boolean | null;
};

function envValue(name: string) {
  return String(process.env[name] ?? "").trim();
}

function safeBoolStatus(value: boolean) {
  return value ? "ready" : "pending";
}

function isNotReady(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(DTE_SUPABASE_PERSISTENCE_NOT_READY)
  );
}

function firstSignatureStatus(input: unknown): string | null {
  if (!Array.isArray(input)) return null;
  const value = input.find((item) => String(item ?? "").trim());
  if (!value) return null;
  const text = String(value);
  const match = text.match(/(?:document|envio)=([^\s,]+)/i);
  return match?.[1] ?? text;
}

function verificationOk(input: unknown): boolean | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  return input.every((item) => /=(ok|true)$/i.test(String(item).trim()));
}

function readMetadataValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object") return undefined;
  return (input as Record<string, unknown>)[key];
}

async function fileStatus(path: string): Promise<ArtifactStatus> {
  const fileName = basename(path);
  if (!existsSync(path)) {
    return { fileName, exists: false, sizeBytes: null, updatedAt: null, sha256: null };
  }

  const fileStat = await stat(path);
  return {
    fileName,
    exists: true,
    sizeBytes: fileStat.size,
    updatedAt: fileStat.mtime.toISOString(),
    sha256: null,
  };
}

async function sha256Status(path: string): Promise<ArtifactStatus> {
  const status = await fileStatus(path);
  if (!status.exists) return status;

  const content = await readFile(path, "utf8").catch(() => "");
  const hash = content.trim().split(/\s+/)[0] ?? "";
  return { ...status, sha256: /^[a-f0-9]{64}$/i.test(hash) ? hash : null };
}

async function metadataSummary(path: string): Promise<MetadataSummary> {
  const fileName = basename(path);
  if (!existsSync(path)) {
    return {
      exists: false,
      fileName,
      updatedAt: null,
      mode: null,
      folio: null,
      documentType: null,
      xsdValid: null,
      xmlSignatureStatus: null,
      verificationOk: null,
      siiContact: null,
      trackIdSimulated: null,
    };
  }

  const [fileStat, raw] = await Promise.all([stat(path), readFile(path, "utf8")]);
  const parsed = JSON.parse(raw) as unknown;
  const xsdValidRaw = readMetadataValue(parsed, "xsdValid");
  const xsdStatusRaw = readMetadataValue(parsed, "xsdStatus");
  const xsdValid =
    typeof xsdValidRaw === "boolean"
      ? xsdValidRaw
      : xsdStatusRaw === "valid"
        ? true
        : xsdStatusRaw === "invalid"
          ? false
          : null;

  return {
    exists: true,
    fileName,
    updatedAt: fileStat.mtime.toISOString(),
    mode: String(readMetadataValue(parsed, "mode") ?? "") || null,
    folio:
      typeof readMetadataValue(parsed, "folio") === "number"
        ? (readMetadataValue(parsed, "folio") as number)
        : null,
    documentType: String(readMetadataValue(parsed, "documentType") ?? "") || null,
    xsdValid,
    xmlSignatureStatus: firstSignatureStatus(
      readMetadataValue(parsed, "xmlSignatureStatuses"),
    ),
    verificationOk: verificationOk(readMetadataValue(parsed, "xmlSignatureVerification")),
    siiContact:
      typeof readMetadataValue(parsed, "siiContact") === "boolean"
        ? (readMetadataValue(parsed, "siiContact") as boolean)
        : null,
    trackIdSimulated:
      typeof readMetadataValue(parsed, "trackIdSimulated") === "boolean"
        ? (readMetadataValue(parsed, "trackIdSimulated") as boolean)
        : null,
  };
}

function externalFileSummary(envName: string, allowedExtensions: string[]) {
  const result = validateExternalDteFile({
    envName,
    allowedExtensions,
    required: true,
  });
  return {
    configured: result.pathConfigured,
    exists: result.exists,
    outsideRepo: result.outsideRepo,
    status: result.status,
    ready: result.ok,
  };
}

function statusItem(label: string, status: string, detail: string) {
  return { label, status, detail };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
    const tenantSlug = String(url.searchParams.get("tenantSlug") ?? "").trim();
    const tenantAccess = await requireTenantAdmin({ req, tenantId, tenantSlug });

    if (!tenantAccess.ok) {
      return NextResponse.json(
        { ok: false, error: tenantAccess.error },
        { status: tenantAccess.status },
      );
    }

    const mode = envValue("DTE_MODE") || "lab";
    const siiEnv = envValue("DTE_SII_ENV") || "certification";
    const backend = getDtePersistenceBackend();
    const readiness = checkDteReadiness();
    const certificationReadiness = buildDteCertificationReadiness();

    const caf = externalFileSummary("DTE_CAF_PATH", [".xml"]);
    const cafPrivateKey = externalFileSummary("DTE_CAF_PRIVATE_KEY_PATH", [".pem"]);
    const cert = externalFileSummary("DTE_CERT_PATH", [".pem", ".crt", ".cer"]);
    const privateKey = externalFileSummary("DTE_PRIVATE_KEY_PATH", [".pem"]);
    const endpointsConfigured = [
      "DTE_SII_SEED_URL",
      "DTE_SII_TOKEN_URL",
      "DTE_SII_SUBMIT_URL",
      "DTE_SII_STATUS_URL",
    ].every((name) => Boolean(envValue(name)));
    const submitEnabled = envValue("DTE_SII_ENABLE_SUBMIT") === "true";

    const xmlPath = resolve(
      process.cwd(),
      envValue("DTE_CERTIFICATION_OUTPUT_PATH") ||
        "tmp/dte-certification/certification-envio-dte.xml",
    );
    const xml = await fileStatus(xmlPath);
    const sha256 = await sha256Status(`${xmlPath}.sha256`);
    const metadata = await metadataSummary(`${xmlPath}.metadata.json`).catch(() => ({
      exists: false,
      fileName: basename(`${xmlPath}.metadata.json`),
      updatedAt: null,
      mode: null,
      folio: null,
      documentType: null,
      xsdValid: null,
      xmlSignatureStatus: "metadata_unreadable",
      verificationOk: null,
      siiContact: null,
      trackIdSimulated: null,
    }));

    const warnings: string[] = [];
    let documents: Awaited<ReturnType<ReturnType<typeof getDteRepository>["listRecentByTenant"]>> = [];
    let submissions: Awaited<ReturnType<ReturnType<typeof getDteRepository>["listSubmissionsByTenant"]>> = [];
    let auditLog: Awaited<ReturnType<ReturnType<typeof getDteRepository>["listAuditLogByTenant"]>> = [];

    try {
      const repo = getDteRepository();
      [documents, submissions, auditLog] = await Promise.all([
        repo.listRecentByTenant({ tenantId: tenantAccess.tenantId, limit: 5 }),
        repo.listSubmissionsByTenant({ tenantId: tenantAccess.tenantId, limit: 5 }),
        repo.listAuditLogByTenant({ tenantId: tenantAccess.tenantId, limit: 5 }),
      ]);
    } catch (error) {
      if (!isNotReady(error)) throw error;
      warnings.push(
        "Persistencia Supabase DTE no lista; revisar migracion LAB antes de usar trazas reales.",
      );
    }

    if (backend !== "supabase") {
      warnings.push("Backend DTE actual: memory. No es Supabase LAB persistente.");
    }

    const lastDocument = documents[0] ?? null;
    const lastSubmission = submissions[0] ?? null;
    const lastAudit = auditLog[0] ?? null;
    const verificationOkValue = metadata.verificationOk;
    const signatureReady = metadata.xmlSignatureStatus === "verified_controlled";
    const xsdReady = metadata.xsdValid === true;
    const submitBlockedReasons = [
      submitEnabled ? null : "DTE_SII_ENABLE_SUBMIT no esta activo",
      xml.exists ? null : "XML certification pendiente",
      metadata.exists ? null : "Metadata certification pendiente",
      signatureReady ? null : "XMLDSig no esta verified_controlled",
      verificationOkValue ? null : "Verificacion local XMLDSig pendiente/fallida",
      xsdReady ? null : "XSD pendiente o fallido",
      endpointsConfigured ? null : "Endpoints SII certification incompletos",
      caf.ready && cafPrivateKey.ready && cert.ready && privateKey.ready
        ? null
        : "CAF/certificado/llaves externas incompletas",
    ].filter((item): item is string => Boolean(item));

    return NextResponse.json({
      ok: true,
      globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
      mode,
      siiEnv,
      backend,
      tenantId: tenantAccess.tenantId,
      tenantSlug: tenantAccess.tenantSlug,
      authMode: tenantAccess.authMode,
      production: {
        enabled: false,
        approvedBySii: false,
        legalIssuingEnabled: false,
      },
      readiness: {
        score: readiness.readinessScore,
        labScore: readiness.labScore,
        certificationScore: readiness.certificationScore,
        productionTechnicalScore: readiness.productionTechnicalScore,
        cafConfigured: caf.configured,
        cafExists: caf.exists,
        cafOutsideRepo: caf.outsideRepo,
        cafPrivateKeyConfigured: cafPrivateKey.configured,
        cafPrivateKeyExists: cafPrivateKey.exists,
        certConfigured: cert.configured,
        certExists: cert.exists,
        privateKeyConfigured: privateKey.configured,
        privateKeyExists: privateKey.exists,
        endpointsConfigured,
        submitEnabled,
        productionBlocked: true,
        configStatus: certificationReadiness.status,
      },
      artifacts: {
        xmlPathConfigured: Boolean(envValue("DTE_CERTIFICATION_OUTPUT_PATH")),
        xmlExists: xml.exists,
        xmlFileName: xml.fileName,
        xmlUpdatedAt: xml.updatedAt,
        xmlSizeBytes: xml.sizeBytes,
        xmlSha256Exists: sha256.exists,
        xmlSha256FileName: sha256.fileName,
        xmlSha256: sha256.sha256,
        metadataExists: metadata.exists,
        metadataFileName: metadata.fileName,
        metadataUpdatedAt: metadata.updatedAt,
        xsdValid: metadata.xsdValid,
        xmlSignatureStatus: metadata.xmlSignatureStatus,
        verificationOk: metadata.verificationOk,
        siiContact: metadata.siiContact,
        trackIdSimulated: metadata.trackIdSimulated,
        folio: metadata.folio,
        documentType: metadata.documentType,
      },
      checklist: {
        base: [
          statusItem("Supabase LAB/persistencia", backend === "supabase" ? "ready" : "pending", backend),
          statusItem("Persistencia DTE disponible", documents.length + submissions.length + auditLog.length > 0 ? "ready" : "pending", "tax_documents/submissions/status/audit"),
          statusItem("RLS/constraints", "pending", "documentado; validar en Supabase LAB"),
          statusItem("Produccion bloqueada", "blocked", "sin aprobacion SII ni feature flag productivo"),
        ],
        externalFiles: [
          statusItem("CAF externo", safeBoolStatus(caf.ready), caf.status),
          statusItem("Llave CAF externa", safeBoolStatus(cafPrivateKey.ready), cafPrivateKey.status),
          statusItem("Certificado externo", safeBoolStatus(cert.ready), cert.status),
          statusItem("Private key externa", safeBoolStatus(privateKey.ready), privateKey.status),
        ],
        xmlSignature: [
          statusItem("TED generado", xml.exists ? "pending" : "pending", "requiere evidencia metadata certification"),
          statusItem("FRMT generado", signatureReady ? "ready" : "pending", metadata.xmlSignatureStatus ?? "pendiente"),
          statusItem("XMLDSig controlado", signatureReady ? "ready" : "pending", metadata.xmlSignatureStatus ?? "pendiente"),
          statusItem("Verificacion local", metadata.verificationOk ? "ready" : "pending", metadata.verificationOk === false ? "fallida" : "pendiente"),
          statusItem("XSD validado", xsdReady ? "ready" : "pending", metadata.xsdValid === false ? "fallido" : "pendiente"),
        ],
        siiCertification: [
          statusItem("Seed endpoint", envValue("DTE_SII_SEED_URL") ? "ready" : "pending", "DTE_SII_SEED_URL"),
          statusItem("Token endpoint", envValue("DTE_SII_TOKEN_URL") ? "ready" : "pending", "DTE_SII_TOKEN_URL"),
          statusItem("Submit endpoint", envValue("DTE_SII_SUBMIT_URL") ? "ready" : "pending", "DTE_SII_SUBMIT_URL"),
          statusItem("Status endpoint", envValue("DTE_SII_STATUS_URL") ? "ready" : "pending", "DTE_SII_STATUS_URL"),
          statusItem("Submit real", submitEnabled ? "blocked" : "blocked", submitEnabled ? "habilitado por env, bloqueado en UI" : "DTE_SII_ENABLE_SUBMIT=false"),
          statusItem("Track ID real", lastSubmission?.trackId ? "ready" : "pending", lastSubmission?.trackId ? "presente" : "pendiente/null; no simulado"),
        ],
      },
      lastTrace: {
        taxDocumentId: lastDocument?.id ?? null,
        folio: lastDocument?.folio ?? null,
        documentType: lastDocument?.documentType ?? null,
        status: lastDocument?.status ?? null,
        siiStatus: lastDocument?.siiStatus ?? null,
        trackId: lastSubmission?.trackId ?? null,
        submissionStatus: lastSubmission?.submissionStatus ?? null,
        lastAuditAction: lastAudit?.action ?? null,
        statusHistory: null,
        updatedAt:
          lastDocument?.updatedAt ?? lastSubmission?.createdAt ?? lastAudit?.createdAt ?? null,
      },
      safeActions: {
        readiness: "available",
        generateXmlCommand: "npm run dte:certification:xml",
        validateXmlCommand: "npm run dte:certification:validate-xml",
        submitCertification: "blocked",
        submitBlockedReasons,
      },
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error calculando status DTE/SII",
      },
      { status: 500 },
    );
  }
}
