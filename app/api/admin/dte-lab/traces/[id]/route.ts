export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { getDtePersistenceBackend, getDteRepository } from "@/lib/dte/persistence/get-dte-repository";
import { redactSensitivePath } from "@/lib/dte/persistence/dte-redaction";
import { DTE_SUPABASE_PERSISTENCE_NOT_READY } from "@/lib/dte/persistence/supabase-dte-repository";

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
      const [documents, submissions, auditLog] = await Promise.all([
        repo.listRecentByTenant({ tenantId: tenantAccess.tenantId, limit: 100 }),
        repo.listSubmissionsByTenant({ tenantId: tenantAccess.tenantId, limit: 100 }),
        repo.listAuditLogByTenant({ tenantId: tenantAccess.tenantId, limit: 100 }),
      ]);
      const document = documents.find((item) => item.id === id);

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

      return NextResponse.json({
        ok: true,
        globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
        backend,
        document: {
          ...document,
          xmlStoragePath: redactSensitivePath(document.xmlStoragePath),
          pdfStoragePath: redactSensitivePath(document.pdfStoragePath),
        },
        submissions: submissions
          .filter((item) => item.taxDocumentId === id)
          .map((item) => ({
            ...item,
            tokenFingerprint: undefined,
          })),
        auditLog: auditLog
          .filter((item) => item.taxDocumentId === id)
          .map((item) => ({
            ...item,
            ipHash: item.ipHash ? "[ip-hash-stored]" : null,
          })),
        warnings:
          backend === "supabase"
            ? []
            : ["Persistencia Supabase no activada; detalle proviene de memory/LAB."],
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
