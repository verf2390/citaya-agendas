export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getDtePersistenceBackend, getDteRepository } from "@/lib/dte/persistence/get-dte-repository";
import { redactSensitivePath } from "@/lib/dte/persistence/dte-redaction";
import type {
  DteSiiStatus,
  TaxDocumentRecord,
  TaxDocumentSubmissionRecord,
} from "@/lib/dte/persistence/dte-persistence-types";
import { DTE_SUPABASE_PERSISTENCE_NOT_READY } from "@/lib/dte/persistence/supabase-dte-repository";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type TraceRequest = {
  tenantId: string;
  tenantSlug?: string;
};

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function getTenantSlugFromReq(req: Request, input: TraceRequest): string {
  return (
    getTenantSlugFromHostname(getHostnameFromReq(req)) ||
    String(input.tenantSlug ?? "").trim()
  );
}

async function requireUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, error: "Unauthorized", status: 401 };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false as const, error: "Unauthorized", status: 401 };
  }

  return { ok: true as const };
}

async function validateTenantAccess(req: Request, input: TraceRequest) {
  const tenantSlug = getTenantSlugFromReq(req, input);
  if (!tenantSlug) {
    return {
      ok: false as const,
      error: "No se pudo detectar el tenant actual",
      status: 400,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id, slug")
    .eq("id", input.tenantId)
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (error || !data?.id) {
    return {
      ok: false as const,
      error: "Tenant no autorizado o inexistente",
      status: 403,
    };
  }

  return { ok: true as const, tenantId: data.id as string };
}

function safeDocument(record: TaxDocumentRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    documentType: record.documentType,
    folio: record.folio,
    status: record.status,
    statusLabel: statusLabel(record.status, record.siiStatus),
    siiStatus: record.siiStatus,
    environmentLabel: "LAB / PENDIENTE / NO PRODUCTIVO",
    emitterRut: record.emitterRut,
    receiverRut: record.receiverRut,
    issueDate: record.issueDate,
    totalAmount: record.totalAmount,
    xmlSha256: record.xmlSha256 ?? null,
    xmlStoragePath: redactSensitivePath(record.xmlStoragePath),
    pdfStoragePath: redactSensitivePath(record.pdfStoragePath),
    appointmentId: record.appointmentId ?? null,
    paymentId: record.paymentId ?? null,
    paymentReference: record.paymentReference ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function safeSubmission(record: TaxDocumentSubmissionRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    taxDocumentId: record.taxDocumentId,
    environment: record.environment,
    trackId: record.trackId ?? null,
    submissionStatus: record.submissionStatus,
    siiStatus: record.siiStatus,
    requestXmlSha256: record.requestXmlSha256 ?? null,
    responseSha256: record.responseSha256 ?? null,
    rawResponseRedacted: record.rawResponseRedacted ?? null,
    tokenFingerprint: record.tokenFingerprint ? "[fingerprint-stored]" : null,
    submittedAt: record.submittedAt ?? null,
    checkedAt: record.checkedAt ?? null,
    createdAt: record.createdAt,
  };
}

function statusLabel(status: TaxDocumentRecord["status"], siiStatus: DteSiiStatus): string {
  if (status === "draft") return "Borrador LAB";
  if (status === "xml_generated") return "XML generado";
  if (status === "signed") return "Firmado tecnicamente";
  if (status === "submitted") return "Enviado certification";
  if (siiStatus === "accepted") return "Aceptado SII";
  if (siiStatus === "rejected") return "Rechazado SII";
  if (siiStatus === "processing" || siiStatus === "sent") return "Pendiente SII";
  return "LAB / PENDIENTE";
}

function isNotReady(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DTE_SUPABASE_PERSISTENCE_NOT_READY);
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    }

    const url = new URL(req.url);
    const input: TraceRequest = {
      tenantId: String(url.searchParams.get("tenantId") ?? "").trim(),
      tenantSlug: String(url.searchParams.get("tenantSlug") ?? "").trim(),
    };
    if (!input.tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido para trazas DTE" },
        { status: 400 },
      );
    }

    const tenantAccess = await validateTenantAccess(req, input);
    if (!tenantAccess.ok) {
      return NextResponse.json(
        { ok: false, error: tenantAccess.error },
        { status: tenantAccess.status },
      );
    }

    const backend = getDtePersistenceBackend();
    const repo = getDteRepository();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 100);
    const status = (url.searchParams.get("status") || undefined) as
      | TaxDocumentRecord["status"]
      | undefined;
    const siiStatus = (url.searchParams.get("sii_status") || undefined) as
      | DteSiiStatus
      | undefined;
    const environment = (url.searchParams.get("environment") || undefined) as
      | TaxDocumentSubmissionRecord["environment"]
      | undefined;
    const warnings: string[] = [];

    try {
      const [documents, submissions, auditLog] = await Promise.all([
        repo.listRecentByTenant({ tenantId: tenantAccess.tenantId, limit, status, siiStatus }),
        repo.listSubmissionsByTenant({
          tenantId: tenantAccess.tenantId,
          limit,
          environment,
          siiStatus,
        }),
        repo.listAuditLogByTenant({ tenantId: tenantAccess.tenantId, limit }),
      ]);

      if (backend !== "supabase") {
        warnings.push("Persistencia Supabase no activada; backend memory/LAB por defecto.");
      }

      return NextResponse.json({
        ok: true,
        globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
        backend,
        documents: documents.map(safeDocument),
        submissions: submissions.map(safeSubmission),
        auditLog: auditLog.map((item) => ({
          id: item.id,
          tenantId: item.tenantId,
          taxDocumentId: item.taxDocumentId ?? null,
          submissionId: item.submissionId ?? null,
          action: item.action,
          actorType: item.actorType,
          actorId: item.actorId ?? null,
          metadataRedacted: item.metadataRedacted,
          ipHash: item.ipHash ? "[ip-hash-stored]" : null,
          createdAt: item.createdAt,
        })),
        warnings,
      });
    } catch (error) {
      if (!isNotReady(error)) throw error;
      return NextResponse.json({
        ok: true,
        globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
        backend,
        documents: [],
        submissions: [],
        auditLog: [],
        warnings: [
          "DTE_SUPABASE_PERSISTENCE_NOT_READY: revisar/aplicar manualmente docs/dte-sii/DTE_SUPABASE_MIGRATION.sql.",
        ],
      });
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Error listando trazas DTE",
      },
      { status: 500 },
    );
  }
}
