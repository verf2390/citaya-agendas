import { NextResponse } from "next/server";

import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

export function tenantSlug(req: Request, fallback: unknown): string {
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return (
    getTenantSlugFromHostname(
      host.split(",")[0]?.trim().split(":")[0] ?? "",
    ) || String(fallback ?? "").trim()
  );
}

export async function requireProductionAdmin(
  req: Request,
  tenantId: unknown,
  tenantSlugValue: unknown,
) {
  return requireTenantAdmin({
    req,
    tenantId: String(tenantId ?? "").trim(),
    tenantSlug: tenantSlug(req, tenantSlugValue),
  });
}

export function safeProductionApiError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "";
  const code =
    message.match(/\bDTE_[A-Z0-9_:-]+\b/)?.[0] ??
    "DTE_PRODUCTION_REQUEST_FAILED";
  const status =
    /NOT_FOUND/.test(code) ? 404
    : /UNAUTHORIZED/.test(code) ? 401
    : /DISABLED|BLOCKED|AMBIGUOUS|ALREADY|STATE|CONFLICT/.test(code) ? 423
    : 400;
  return NextResponse.json({ ok: false, error: code }, { status });
}
