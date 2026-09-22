import { AIError } from "@/lib/ai/errors";
import type { TenantAdminAuthMode } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

if (typeof window !== "undefined") {
  throw new Error("AI usage telemetry is server-only");
}

export type AIUsageSummary = {
  requests: number;
  succeeded: number;
  failed: number;
  localRequests: number;
  cloudRequests: number;
  fallbackRequests: number;
  totalTokens: number;
  cloudTokens: number;
  cloudInputTokens: number;
  cloudOutputTokens: number;
  avgDurationMs: number;
  avgProviderDurationMs: number;
};

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export async function loadAIUsageSummary(input: {
  tenantId: string;
  userId: string;
  authMode: TenantAdminAuthMode;
  since: Date;
  signal?: AbortSignal;
}): Promise<AIUsageSummary> {
  if (Number.isNaN(input.since.getTime())) {
    throw new AIError("AI_INVALID_REQUEST", "Rango de telemetría inválido");
  }

  const query = supabaseAdmin.rpc("get_ai_usage_summary", {
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_auth_mode: input.authMode,
    p_since: input.since.toISOString(),
  });
  if (input.signal) query.abortSignal(input.signal);
  const { data, error } = await query;

  if (input.signal?.aborted) {
    throw new AIError("AI_TIMEOUT", "La telemetría excedió el tiempo máximo");
  }
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new AIError(
      "AI_AUDIT_UNAVAILABLE",
      "No se pudo cargar la telemetría de IA",
    );
  }

  const row = data as Record<string, unknown>;
  return {
    requests: count(row.requests),
    succeeded: count(row.succeeded),
    failed: count(row.failed),
    localRequests: count(row.local_requests),
    cloudRequests: count(row.cloud_requests),
    fallbackRequests: count(row.fallback_requests),
    totalTokens: count(row.total_tokens),
    cloudTokens: count(row.cloud_tokens),
    cloudInputTokens: count(row.cloud_input_tokens),
    cloudOutputTokens: count(row.cloud_output_tokens),
    avgDurationMs: count(row.avg_duration_ms),
    avgProviderDurationMs: count(row.avg_provider_duration_ms),
  };
}
