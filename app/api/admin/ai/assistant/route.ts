export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { AIError, safeAIErrorCode } from "@/lib/ai/errors";
import { runCitayaAppAssistant } from "@/lib/ai/server/citaya-app-assistant";
import { loadAITenantPolicy } from "@/lib/ai/server/tenant-policy";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { consumeRateLimit } from "@/lib/security/request";
import type { AIConversationMessage } from "@/lib/ai/types";

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

function parseHistory(value: unknown): AIConversationMessage[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) return null;
  const history: AIConversationMessage[] = [];
  let totalLength = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (record.role !== "user" && record.role !== "assistant") return null;
    const text = String(record.text ?? "").trim();
    if (!text || text.length > 2_000) return null;
    totalLength += text.length;
    if (totalLength > 6_000) return null;
    history.push({ role: record.role, text });
  }
  return history;
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
  const history =
    body && typeof body === "object" && !Array.isArray(body)
      ? parseHistory((body as Record<string, unknown>).history)
      : null;
  if (!message || message.length > 2_000) {
    return json(
      { ok: false, error: "El mensaje debe tener entre 1 y 2000 caracteres." },
      400,
    );
  }
  if (!history) {
    return json({ ok: false, error: "El historial no es válido." }, 400);
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
      history,
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
