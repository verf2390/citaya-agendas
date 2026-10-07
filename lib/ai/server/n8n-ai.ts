import { runAICore } from "@/lib/ai/core";
import { AIError } from "@/lib/ai/errors";
import {
  buildN8NInstructions,
  CITAYA_N8N_PROMPT_VERSION,
  type N8NAIOperation,
} from "@/lib/ai/prompts/n8n-v1";
import { createAIProvider } from "@/lib/ai/provider-factory";
import {
  beginAIServiceRequestAudit,
  finishAIServiceRequestAuditBounded,
} from "@/lib/ai/server/audit";
import type { AITenantPolicy } from "@/lib/ai/server/tenant-policy";
import { reservedTokensForAIRequest } from "@/lib/ai/server/token-budget";
import type { AIRouteSummary, AIUsage } from "@/lib/ai/types";

const ZERO_USAGE: AIUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

function maxOutputTokens(operation: N8NAIOperation, policyMax: number) {
  const operationMax =
    operation === "classify" ? 64 : operation === "summarize" ? 192 : 320;
  return Math.min(policyMax, operationMax);
}

function canonicalClassification(text: string, labels: string[]) {
  const normalized = text.trim().toLocaleLowerCase("es");
  return (
    labels.find(
      (label) => label.trim().toLocaleLowerCase("es") === normalized,
    ) ?? null
  );
}

export async function runN8NAI(input: {
  tenantId: string;
  tenantSlug: string;
  serviceId: "n8n";
  workflowId: string;
  operation: N8NAIOperation;
  source: string;
  instruction?: string;
  labels?: string[];
  policy: AITenantPolicy;
}) {
  if (!input.policy.enabled) {
    throw new AIError("AI_DISABLED", "La IA no está habilitada para este tenant");
  }

  const startedAt = Date.now();
  const provider = createAIProvider({
    provider: input.policy.provider,
    model: input.policy.model,
  });
  const outputLimit = maxOutputTokens(
    input.operation,
    input.policy.maxOutputTokens,
  );
  const requestTimeoutMs = Math.max(1, input.policy.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  let requestId: string | null = null;
  let observedUsage: AIUsage = ZERO_USAGE;
  let observedRoute: AIRouteSummary | undefined;

  try {
    requestId = await beginAIServiceRequestAudit({
      tenantId: input.tenantId,
      productId: "n8n",
      serviceId: input.serviceId,
      workflowId: input.workflowId,
      provider: provider.id,
      model: provider.model,
      promptVersion: CITAYA_N8N_PROMPT_VERSION,
      dailyTokenLimit: input.policy.dailyTokenLimit,
      reservedTokens: reservedTokensForAIRequest({
        dailyTokenLimit: input.policy.dailyTokenLimit,
        maxOutputTokens: outputLimit,
      }),
      signal: controller.signal,
    });

    const remainingTimeoutMs = requestTimeoutMs - (Date.now() - startedAt);
    if (remainingTimeoutMs <= 0 || controller.signal.aborted) {
      throw new AIError(
        "AI_TIMEOUT",
        "La solicitud de IA excedió el tiempo máximo",
      );
    }

    const result = await runAICore({
      provider,
      instructions: buildN8NInstructions({
        operation: input.operation,
        instruction: input.instruction,
        labels: input.labels,
      }),
      message: input.source,
      tools: [],
      context: {
        tenantId: input.tenantId,
        tenantSlug: input.tenantSlug,
        userId: "service:n8n",
        timezone: "America/Santiago",
        now: new Date(),
        signal: controller.signal,
      },
      maxOutputTokens: outputLimit,
      timeoutMs: remainingTimeoutMs,
      maxSteps: 1,
      maxToolCallsPerStep: 1,
    });
    observedUsage = result.usage;
    observedRoute = result.route;

    let text = result.text.trim();
    if (input.operation === "classify") {
      const canonical = canonicalClassification(text, input.labels ?? []);
      if (!canonical) {
        throw new AIError(
          "AI_PROVIDER_INVALID_RESPONSE",
          "La clasificación no coincide con una etiqueta permitida",
        );
      }
      text = canonical;
    }

    await finishAIServiceRequestAuditBounded({
      requestId,
      tenantId: input.tenantId,
      serviceId: input.serviceId,
      status: "succeeded",
      toolNames: [],
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      route: result.route,
    });

    return {
      text,
      usage: result.usage,
      route: result.route,
    };
  } catch (error) {
    if (requestId) {
      try {
        await finishAIServiceRequestAuditBounded({
          requestId,
          tenantId: input.tenantId,
          serviceId: input.serviceId,
          status: "failed",
          toolNames: [],
          usage: observedUsage,
          durationMs: Date.now() - startedAt,
          route: observedRoute,
          error,
        });
      } catch (auditError) {
        console.error("[ai/n8n/audit] failed to close request", {
          tenantId: input.tenantId,
          workflowId: input.workflowId,
          code: auditError instanceof AIError ? auditError.code : "unknown",
        });
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
