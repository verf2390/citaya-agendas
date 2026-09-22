import { runAICore } from "@/lib/ai/core";
import { AIError } from "@/lib/ai/errors";
import {
  assertCitayaAppPromptVersion,
  buildCitayaAppAssistantInstructions,
} from "@/lib/ai/prompts/citaya-app-v1";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { beginAIRequestAudit, finishAIRequestAudit } from "@/lib/ai/server/audit";
import { SupabaseCitayaAppReadRepository } from "@/lib/ai/server/citaya-app-repository";
import type { AITenantPolicy } from "@/lib/ai/server/tenant-policy";
import { reservedTokensForAIRequest } from "@/lib/ai/server/token-budget";
import { createCitayaAppReadTools } from "@/lib/ai/tools/citaya-app-read";
import type { AIUsage } from "@/lib/ai/types";
import type { AIConversationMessage } from "@/lib/ai/types";
import type { TenantAdminAuthMode } from "@/lib/api/requireTenantAdmin";

const ZERO_USAGE: AIUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export async function runCitayaAppAssistant(input: {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  authMode: TenantAdminAuthMode;
  message: string;
  history?: AIConversationMessage[];
  policy: AITenantPolicy;
  now?: Date;
}) {
  if (!input.policy.enabled) {
    throw new AIError("AI_DISABLED", "La IA no está habilitada para este tenant");
  }

  const now = input.now ?? new Date();
  const startedAt = Date.now();
  const promptVersion = assertCitayaAppPromptVersion(
    input.policy.promptVersion,
  );
  const provider = createAIProvider({
    provider: input.policy.provider,
    model: input.policy.model,
  });
  const requestTimeoutMs = Math.max(1, input.policy.timeoutMs);
  const deadlineAt = startedAt + requestTimeoutMs;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(),
    requestTimeoutMs,
  );
  let requestId: string | null = null;

  try {
    requestId = await beginAIRequestAudit({
      tenantId: input.tenantId,
      userId: input.userId,
      authMode: input.authMode,
      provider: provider.id,
      model: provider.model,
      promptVersion,
      dailyTokenLimit: input.policy.dailyTokenLimit,
      reservedTokens: reservedTokensForAIRequest(input.policy),
      signal: deadlineController.signal,
    });

    const remainingTimeoutMs = deadlineAt - Date.now();
    if (remainingTimeoutMs <= 0 || deadlineController.signal.aborted) {
      throw new AIError(
        "AI_TIMEOUT",
        "La solicitud de IA excedió el tiempo máximo",
      );
    }

    const result = await runAICore({
      provider,
      instructions: buildCitayaAppAssistantInstructions({
        now,
        timezone: "America/Santiago",
        tenantSlug: input.tenantSlug,
      }),
      message: input.message,
      history: input.history,
      tools: createCitayaAppReadTools(new SupabaseCitayaAppReadRepository()),
      context: {
        tenantId: input.tenantId,
        tenantSlug: input.tenantSlug,
        userId: input.userId,
        timezone: "America/Santiago",
        now,
      },
      maxOutputTokens: input.policy.maxOutputTokens,
      timeoutMs: remainingTimeoutMs,
      maxSteps: 4,
      maxToolCallsPerStep: 3,
    });

    await finishAIRequestAudit({
      requestId,
      tenantId: input.tenantId,
      userId: input.userId,
      status: "succeeded",
      toolNames: result.toolsUsed,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      route: result.route,
      signal: deadlineController.signal,
    });
    return result;
  } catch (error) {
    if (requestId) {
      try {
        await finishAIRequestAudit({
          requestId,
          tenantId: input.tenantId,
          userId: input.userId,
          status: "failed",
          toolNames: [],
          usage: ZERO_USAGE,
          durationMs: Date.now() - startedAt,
          error,
          signal: deadlineController.signal,
        });
      } catch (auditError) {
        console.error("[ai/audit] failed to close request", {
          tenantId: input.tenantId,
          code: auditError instanceof AIError ? auditError.code : "unknown",
        });
      }
    }
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
  }
}
