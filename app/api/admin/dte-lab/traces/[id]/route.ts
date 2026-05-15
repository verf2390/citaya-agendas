export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getDtePersistenceBackend, getDteRepository } from "@/lib/dte/persistence/get-dte-repository";
import { redactSensitivePath } from "@/lib/dte/persistence/dte-redaction";
import { DTE_SUPABASE_PERSISTENCE_NOT_READY } from "@/lib/dte/persistence/supabase-dte-repository";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

async function requireUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, error: "Unauthorized", status: 401 };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { ok: false as const, error: "Unauthorized", status: 401 };
  return { ok: true as const };
}

async function validateTenantAccess(req: Request, tenantId: string, tenantSlugInput: string) {
  const tenantSlug =
    getTenantSlugFromHostname(getHostnameFromReq(req)) || tenantSlugInput.trim();
  if (!tenantSlug) {
    return { ok: false as const, error: "No se pudo detectar el tenant actual", status: 400 };
  }

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id, slug")
    .eq("id", tenantId)
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (error || !data?.id) {
    return { ok: false as const, error: "Tenant no autorizado o inexistente", status: 403 };
  }

  return { ok: true as const, tenantId: data.id as string };
}

function isNotReady(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DTE_SUPABASE_PERSISTENCE_NOT_READY);
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;
    const url = new URL(req.url);
    const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
    const tenantSlug = String(url.searchParams.get("tenantSlug") ?? "").trim();
    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido para detalle DTE" },
        { status: 400 },
      );
    }

    const tenantAccess = await validateTenantAccess(req, tenantId, tenantSlug);
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
            tokenFingerprint: item.tokenFingerprint ? "[fingerprint-stored]" : null,
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
