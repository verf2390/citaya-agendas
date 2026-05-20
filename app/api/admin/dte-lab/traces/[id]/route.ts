export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { getDtePersistenceBackend, getDteRepository } from "@/lib/dte/persistence/get-dte-repository";
import { redactSensitivePath } from "@/lib/dte/persistence/dte-redaction";
import type {
  TaxDocumentAuditRecord,
  TaxDocumentRecord,
  TaxDocumentSubmissionRecord,
} from "@/lib/dte/persistence/dte-persistence-types";
import { DTE_SUPABASE_PERSISTENCE_NOT_READY } from "@/lib/dte/persistence/supabase-dte-repository";


function safeDocument(record: TaxDocumentRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    documentType: record.documentType,
    folio: record.folio,
    status: record.status,
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

function safeAuditLog(record: TaxDocumentAuditRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    taxDocumentId: record.taxDocumentId ?? null,
    submissionId: record.submissionId ?? null,
    action: record.action,
    actorType: record.actorType,
    actorId: record.actorId ?? null,
    metadataRedacted: record.metadataRedacted,
    ipHash: record.ipHash ? "[ip-hash-stored]" : null,
    createdAt: record.createdAt,
  };
}

function isNotReady(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DTE_SUPABASE_PERSISTENCE_NOT_READY);
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
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

    const backend = getDtePersistenceBackend();
    const repo = getDteRepository();

    try {
      const document = await repo.findTaxDocumentById({
        tenantId: tenantAccess.tenantId,
        id,
      });

      if (!document) {
        return NextResponse.json(
          {
            ok: false,
            error: "Traza DTE no encontrada para el tenant",
            globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
            backend,
          },
          { status: 404 },
        );
      }

      const [submissions, auditLog] = await Promise.all([
        repo.listSubmissionsByTenant({ tenantId: tenantAccess.tenantId, limit: 100 }),
        repo.listAuditLogByTenant({ tenantId: tenantAccess.tenantId, limit: 100 }),
      ]);

      return NextResponse.json({
        ok: true,
        globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
        backend,
        authMode: tenantAccess.authMode,
        document: safeDocument(document),
        submissions: submissions
          .filter((item) => item.taxDocumentId === id)
          .map(safeSubmission),
        auditLog: auditLog
          .filter((item) => item.taxDocumentId === id)
          .map(safeAuditLog),
        warnings: [
          ...(backend === "supabase"
            ? []
            : ["Persistencia Supabase no activada; detalle proviene de memory/LAB."]),
          ...(tenantAccess.authMode === "legacy_host_tenant_match"
            ? ["Autorizacion admin usando fallback legacy host/tenant; confirmar tenant_members antes de activar Supabase."]
            : []),
        ],
      });
    } catch (error) {
      if (!isNotReady(error)) throw error;
      return NextResponse.json({
        ok: true,
        globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
        backend,
        document: null,
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
          error instanceof Error ? error.message : "Error leyendo detalle DTE",
      },
      { status: 500 },
    );
  }
}
