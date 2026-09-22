import { AIError, safeAIErrorCode } from "@/lib/ai/errors";
import type { AIProviderId, AIRouteSummary, AIUsage } from "@/lib/ai/types";
import type { TenantAdminAuthMode } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

if (typeof window !== "undefined") {
  throw new Error("AI audit is server-only");
}

export async function beginAIRequestAudit(input: {
  tenantId: string;
  userId: string;
  authMode: TenantAdminAuthMode;
  provider: AIProviderId;
  model: string;
  promptVersion: string;
  dailyTokenLimit: number;
  reservedTokens: number;
  signal?: AbortSignal;
}) {
  const query = supabaseAdmin.rpc("begin_ai_request_audit", {
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_auth_mode: input.authMode,
    p_provider: input.provider,
    p_model: input.model,
    p_prompt_version: input.promptVersion,
    p_daily_token_limit: input.dailyTokenLimit,
    p_reserved_tokens: input.reservedTokens,
  });
  if (input.signal) query.abortSignal(input.signal);
  const { data, error } = await query;

  if (input.signal?.aborted) {
    throw new AIError("AI_TIMEOUT", "La solicitud de IA excedió el tiempo máximo");
  }
  if (error) {
    if (String(error.message ?? "").includes("AI_DAILY_TOKEN_LIMIT")) {
      throw new AIError(
        "AI_DAILY_TOKEN_LIMIT",
        "El tenant alcanzó su límite diario de IA",
      );
    }
    throw new AIError(
      "AI_AUDIT_UNAVAILABLE",
      "No se pudo iniciar la auditoría de IA",
    );
  }
  const requestId = String(data ?? "");
  if (!requestId) {
    throw new AIError(
      "AI_AUDIT_UNAVAILABLE",
      "La auditoría de IA no devolvió un identificador",
    );
  }
  return requestId;
}

export async function finishAIRequestAudit(input: {
  requestId: string;
  tenantId: string;
  userId: string;
  status: "succeeded" | "failed";
  toolNames: string[];
  usage: AIUsage;
  durationMs: number;
  route?: AIRouteSummary;
  error?: unknown;
  signal?: AbortSignal;
}) {
  const query = supabaseAdmin.rpc("finish_ai_request_audit", {
    p_request_id: input.requestId,
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_status: input.status,
    p_tool_names: input.toolNames,
    p_input_tokens: input.usage.inputTokens,
    p_output_tokens: input.usage.outputTokens,
    p_total_tokens: input.usage.totalTokens,
    p_duration_ms: Math.max(0, Math.round(input.durationMs)),
    p_effective_provider: input.route?.effectiveProvider ?? null,
    p_effective_model: input.route?.effectiveModel ?? null,
    p_fallback_used: input.route?.fallbackUsed ?? false,
    p_provider_duration_ms:
      input.route == null
        ? null
        : Math.max(0, Math.round(input.route.providerDurationMs)),
    p_error_code: input.error ? safeAIErrorCode(input.error) : null,
  });
  if (input.signal) query.abortSignal(input.signal);
  const { data, error } = await query;
  if (input.signal?.aborted) {
    throw new AIError("AI_TIMEOUT", "La solicitud de IA excedió el tiempo máximo");
  }
  if (error || data !== true) {
    throw new AIError(
      "AI_AUDIT_UNAVAILABLE",
      "No se pudo cerrar la auditoría de IA",
    );
  }
}
