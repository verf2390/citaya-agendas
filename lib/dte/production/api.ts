import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";

export async function requireProductionAdmin(
  req: Request,
  ...legacyTenantHints: unknown[]
) {
  void legacyTenantHints;
  return requireHostTenantAdmin(req);
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
