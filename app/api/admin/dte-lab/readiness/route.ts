export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { checkDteReadiness } from "@/lib/dte/readiness/check-dte-readiness";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type ReadinessRequest = {
  tenantId?: string;
  tenantSlug?: string;
};

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

async function validateTenantAccess(req: Request, tenantId: string, body?: { tenantSlug?: string } | null) {
  return requireTenantAdmin({ req, tenantId, tenantSlug: getTenantSlugFromReq(req, body) });
}

export async function POST(req: Request) {
  try {
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
