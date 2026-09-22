import { AIError } from "@/lib/ai/errors";
import type { AIProviderId } from "@/lib/ai/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

if (typeof window !== "undefined") {
  throw new Error("AI tenant policy is server-only");
}

export type AITenantPolicy = {
  enabled: boolean;
  provider: AIProviderId;
  model: string;
  requestsPerMinute: number;
  dailyTokenLimit: number;
  maxOutputTokens: number;
  timeoutMs: number;
};

type PolicyRow = {
  enabled: boolean;
  provider: string;
  model_override: string | null;
  requests_per_minute: number;
  daily_token_limit: number;
  max_output_tokens: number;
  timeout_ms: number;
};

function integerEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function booleanEnv(name: string, fallback: boolean) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function providerEnv(): AIProviderId {
  return process.env.CITAYA_AI_PROVIDER?.trim().toLowerCase() === "local"
    ? "local"
    : "openai";
}

function configuredModel(provider: AIProviderId, override?: string | null) {
  const value =
    override?.trim() ||
    (provider === "openai"
      ? process.env.CITAYA_AI_OPENAI_MODEL?.trim()
      : process.env.CITAYA_AI_LOCAL_MODEL?.trim());
  if (!value) {
    throw new AIError(
      "AI_PROVIDER_CONFIG",
      `Falta configurar el modelo para ${provider}`,
    );
  }
  return value;
}

export async function loadAITenantPolicy(
  tenantId: string,
): Promise<AITenantPolicy> {
  const { data, error } = await supabaseAdmin
    .from("ai_tenant_settings")
    .select(
      "enabled, provider, model_override, requests_per_minute, daily_token_limit, max_output_tokens, timeout_ms",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new AIError(
      "AI_PROVIDER_CONFIG",
      "No se pudo cargar la configuración de IA",
    );
  }

  const row = data as PolicyRow | null;
  const provider: AIProviderId =
    row?.provider === "local" || row?.provider === "openai"
      ? row.provider
      : providerEnv();

  return {
    enabled: row?.enabled ?? booleanEnv("CITAYA_AI_ENABLED", false),
    provider,
    model: configuredModel(provider, row?.model_override),
    requestsPerMinute:
      row?.requests_per_minute ??
      integerEnv("CITAYA_AI_REQUESTS_PER_MINUTE", 10, 1, 60),
    dailyTokenLimit:
      row?.daily_token_limit ??
      integerEnv("CITAYA_AI_DAILY_TOKEN_LIMIT", 50_000, 1_000, 10_000_000),
    maxOutputTokens:
      row?.max_output_tokens ??
      integerEnv("CITAYA_AI_MAX_OUTPUT_TOKENS", 800, 128, 4_096),
    timeoutMs:
      row?.timeout_ms ??
      integerEnv("CITAYA_AI_TIMEOUT_MS", 20_000, 1_000, 120_000),
  };
}
