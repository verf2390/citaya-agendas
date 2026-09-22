export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { AIError, safeAIErrorCode } from "@/lib/ai/errors";
import { loadAIUsageSummary } from "@/lib/ai/server/usage";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(req: Request) {
  const access = await requireHostTenantAdmin(req);
  if (!access.ok) {
    return json(
      {
        ok: false,
        error: access.status === 401 ? "Unauthorized" : "Forbidden",
      },
      access.status,
    );
  }

  const url = new URL(req.url);
  const daysValue = url.searchParams.get("days") ?? "7";
  const days = Number(daysValue);
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    return json({ ok: false, error: "Rango inválido" }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const summary = await loadAIUsageSummary({
      tenantId: access.tenantId,
      userId: access.userId,
      authMode: access.authMode,
      since: new Date(Date.now() - days * 86_400_000),
      signal: controller.signal,
    });
    return json({ ok: true, days, summary });
  } catch (error) {
    const code = safeAIErrorCode(error);
    console.error("[admin/ai/usage] request failed", {
      tenantId: access.tenantId,
      code,
    });
    if (error instanceof AIError && error.code === "AI_TIMEOUT") {
      return json({ ok: false, error: "La telemetría tardó demasiado." }, 504);
    }
    return json({ ok: false, error: "No se pudo cargar la telemetría." }, 502);
  } finally {
    clearTimeout(timer);
  }
}
