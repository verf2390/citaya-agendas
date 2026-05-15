export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { checkDteReadiness } from "@/lib/dte/readiness/check-dte-readiness";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type ReadinessRequest = {
  tenantId?: string;
  tenantSlug?: string;
};

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";

  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function getTenantSlugFromReq(
  req: Request,
  body?: ReadinessRequest | null,
): string {
  return (
    getTenantSlugFromHostname(getHostnameFromReq(req)) ||
    String(body?.tenantSlug ?? "").trim()
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

async function validateTenantAccess(
  req: Request,
  tenantId: string,
  body?: ReadinessRequest | null,
) {
  const tenantSlug = getTenantSlugFromReq(req, body);

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
    .eq("id", tenantId)
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (error || !data?.id) {
    return {
      ok: false as const,
      error: "Tenant no autorizado o inexistente",
      status: 403,
    };
  }

  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    }

    const body = (await req.json().catch(() => null)) as ReadinessRequest | null;
    const tenantId = String(body?.tenantId ?? "").trim();

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido para readiness DTE" },
        { status: 400 },
      );
    }

    const tenantAccess = await validateTenantAccess(req, tenantId, body);
    if (!tenantAccess.ok) {
      return NextResponse.json(
        { ok: false, error: tenantAccess.error },
        { status: tenantAccess.status },
      );
    }

    const readiness = checkDteReadiness();

    return NextResponse.json({
      ok: true,
      readinessScore: readiness.readinessScore,
      labScore: readiness.labScore,
      certificationScore: readiness.certificationScore,
      productionTechnicalScore: readiness.productionTechnicalScore,
      globalStatus: readiness.globalStatus,
      items: readiness.items,
      blockers: readiness.blockers,
      nextActions: readiness.nextActions,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error calculando readiness DTE",
      },
      { status: 500 },
    );
  }
}
