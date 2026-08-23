import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";

const SAFE_PRODUCTION_ERROR_CODE =
  /\b(?:DTE|BOLETA_REST|BOLETA_API)_[A-Z0-9_:-]+\b/;
const DEFAULT_PRODUCTION_ERROR_CODE = "DTE_PRODUCTION_REQUEST_FAILED";

export async function requireProductionAdmin(
  req: Request,
  ...legacyTenantHints: unknown[]
) {
  void legacyTenantHints;
  return requireHostTenantAdmin(req);
}

export function safeProductionApiErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.match(SAFE_PRODUCTION_ERROR_CODE)?.[0] ??
    DEFAULT_PRODUCTION_ERROR_CODE;
}

export function safeProductionApiError(error: unknown): NextResponse {
  const code = safeProductionApiErrorCode(error);
  const status =
    /NOT_FOUND/.test(code) ? 404
    : /UNAUTHORIZED/.test(code) ? 401
    : /DISABLED|BLOCKED|AMBIGUOUS|ALREADY|STATE|CONFLICT/.test(code) ? 423
    : 400;
  return NextResponse.json({ ok: false, error: code }, { status });
}
