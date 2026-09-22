export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { AIError, safeAIErrorCode } from "@/lib/ai/errors";
import { runCitayaAppAssistant } from "@/lib/ai/server/citaya-app-assistant";
import { loadAITenantPolicy } from "@/lib/ai/server/tenant-policy";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { consumeRateLimit } from "@/lib/security/request";

// CIT-64: privileged business reads are delegated to server-only helpers backed
// by supabaseAdmin; this route remains bound to requireHostTenantAdmin.

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function publicError(error: unknown) {
  const code = safeAIErrorCode(error);
  if (code === "AI_DISABLED" || code === "AI_PROVIDER_CONFIG") {
    return json(
      { ok: false, code, error: "El asistente IA aún no está disponible." },
      503,
    );
  }
  if (code === "AI_DAILY_TOKEN_LIMIT") {
    return json(
      { ok: false, code, error: "Se alcanzó el límite diario de IA." },
      429,
    );
  }
  if (code === "AI_TIMEOUT") {
    return json(
      { ok: false, code, error: "El asistente tardó demasiado. Inténtalo nuevamente." },
      504,
    );
  }
  if (code === "AI_INVALID_REQUEST" || code === "AI_TOOL_INVALID_ARGUMENTS") {
    return json({ ok: false, code, error: "La solicitud no es válida." }, 400);
  }
  return json(
    { ok: false, code, error: "No se pudo completar la consulta de IA." },
    502,
  );
}

export async function POST(req: Request) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }
  const message =
    body && typeof body === "object" && !Array.isArray(body)
      ? String((body as Record<string, unknown>).message ?? "").trim()
      : "";
  if (!message || message.length > 2_000) {
    return json(
      { ok: false, error: "El mensaje debe tener entre 1 y 2000 caracteres." },
      400,
    );
  }

  try {
    const policy = await loadAITenantPolicy(access.tenantId);
    if (!policy.enabled) {
      throw new AIError("AI_DISABLED", "IA deshabilitada");
    }
    const allowed = await consumeRateLimit({
      scope: "ai_assistant_minute",
      key: `${access.tenantId}:${access.userId}`,
      limit: policy.requestsPerMinute,
      windowSeconds: 60,
    });
    if (!allowed) {
      return json(
        { ok: false, code: "AI_RATE_LIMIT", error: "Demasiadas consultas. Espera un minuto." },
        429,
      );
    }

    const result = await runCitayaAppAssistant({
      tenantId: access.tenantId,
      tenantSlug: access.tenantSlug,
      userId: access.userId,
      authMode: access.authMode,
      message,
      policy,
    });
    return json({
      ok: true,
      answer: result.text,
      toolsUsed: result.toolsUsed,
      usage: result.usage,
    });
  } catch (error) {
    console.error("[admin/ai/assistant] request failed", {
      tenantId: access.tenantId,
      code: safeAIErrorCode(error),
    });
    return publicError(error);
  }
}
