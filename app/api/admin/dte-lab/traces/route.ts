export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { getDtePersistenceBackend, getDteRepository } from "@/lib/dte/persistence/get-dte-repository";
import { redactSensitivePath } from "@/lib/dte/persistence/dte-redaction";
import type {
  DteSiiStatus,
  TaxDocumentRecord,
  TaxDocumentSubmissionRecord,
} from "@/lib/dte/persistence/dte-persistence-types";
import { DTE_SUPABASE_PERSISTENCE_NOT_READY } from "@/lib/dte/persistence/supabase-dte-repository";

type TraceRequest = {
  tenantId: string;
  tenantSlug?: string;
};

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
    const url = new URL(req.url);
    const input: TraceRequest = {
      tenantId: String(url.searchParams.get("tenantId") ?? "").trim(),
      tenantSlug: String(url.searchParams.get("tenantSlug") ?? "").trim(),
    };
    const tenantAccess = await requireTenantAdmin({ req, ...input });
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
        authMode: tenantAccess.authMode,
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
