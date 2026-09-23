import { AIError } from "@/lib/ai/errors";
import type {
  AICoreResult,
  AIConversationMessage,
  AIEffectiveProviderId,
  AIProvider,
  AIProviderInput,
  AITool,
  AIToolContext,
  AIUsage,
} from "@/lib/ai/types";

const EMPTY_USAGE: AIUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

function addUsage(left: AIUsage, right: AIUsage): AIUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function executeWithTimeout<T>(
  execute: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      new AIError("AI_TIMEOUT", "La solicitud de IA excedió el tiempo máximo"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        new AIError("AI_TIMEOUT", "La solicitud de IA excedió el tiempo máximo"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve()
      .then(execute)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function runAICore(input: {
  provider: AIProvider;
  instructions: string;
  message: string;
  history?: AIConversationMessage[];
  tools: AITool[];
  context: AIToolContext;
  maxOutputTokens: number;
  maxSteps?: number;
  maxToolCallsPerStep?: number;
  timeoutMs: number;
}): Promise<AICoreResult> {
  const message = input.message.trim();
  if (!message) {
    throw new AIError("AI_INVALID_REQUEST", "El mensaje está vacío");
  }

  const maxSteps = Math.min(Math.max(input.maxSteps ?? 4, 1), 6);
  const maxToolCallsPerStep = Math.min(
    Math.max(input.maxToolCallsPerStep ?? 4, 1),
    8,
  );
  const toolByName = new Map(
    input.tools.map((tool) => [tool.definition.name, tool]),
  );
  if (toolByName.size !== input.tools.length) {
    throw new AIError("AI_INVALID_REQUEST", "Hay tools duplicadas");
  }

  const timeout = timeoutSignal(input.timeoutMs);
  let providerInput: AIProviderInput[] = [
    ...(input.history ?? []).map((item) => ({
      type: item.role,
      text: item.text,
    }) satisfies AIProviderInput),
    { type: "user", text: message },
  ];
  let continuation: unknown;
  let usage = EMPTY_USAGE;
  let effectiveProvider: AIEffectiveProviderId | null =
    input.provider.id === "hybrid" ? null : input.provider.id;
  let effectiveModel =
    input.provider.id === "hybrid" ? "" : input.provider.model;
  let fallbackUsed = false;
  let providerDurationMs = 0;
  const toolsUsed = new Set<string>();

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      let turn;
      const providerStartedAt = Date.now();
      try {
        turn = await input.provider.generate({
          instructions: input.instructions,
          input: providerInput,
          tools: input.tools.map((tool) => tool.definition),
          maxOutputTokens: input.maxOutputTokens,
          continuation,
          signal: timeout.signal,
        });
      } catch (error) {
        if (timeout.signal.aborted) {
          throw new AIError("AI_TIMEOUT", "La solicitud de IA excedió el tiempo máximo", {
            cause: error,
          });
        }
        throw error;
      } finally {
        providerDurationMs += Date.now() - providerStartedAt;
      }

      const routedProvider =
        turn.route?.effectiveProvider ??
        (input.provider.id === "hybrid" ? null : input.provider.id);
      const routedModel =
        turn.route?.effectiveModel ??
        (input.provider.id === "hybrid" ? "" : input.provider.model);
      if (!routedProvider || !routedModel) {
        throw new AIError(
          "AI_PROVIDER_INVALID_RESPONSE",
          "El proveedor híbrido no informó su ruta efectiva",
        );
      }
      if (effectiveProvider && effectiveProvider !== routedProvider) {
        throw new AIError(
          "AI_PROVIDER_INVALID_RESPONSE",
          "El proveedor cambió de ruta durante el tool loop",
        );
      }
      if (effectiveModel && effectiveModel !== routedModel) {
        throw new AIError(
          "AI_PROVIDER_INVALID_RESPONSE",
          "El proveedor cambió de modelo durante el tool loop",
        );
      }
      effectiveProvider = routedProvider;
      effectiveModel = routedModel;
      fallbackUsed = fallbackUsed || turn.route?.fallbackUsed === true;

      usage = addUsage(usage, turn.usage);
      continuation = turn.continuation;

      if (turn.toolCalls.length === 0) {
        const text = turn.text.trim();
        if (!text) {
          throw new AIError(
            "AI_PROVIDER_INVALID_RESPONSE",
            "El proveedor no devolvió texto ni tools",
          );
        }
        return {
          text,
          toolsUsed: Array.from(toolsUsed),
          usage,
          steps: step,
          route: {
            requestedProvider: input.provider.id,
            requestedModel: input.provider.model,
            effectiveProvider,
            effectiveModel,
            fallbackUsed,
            providerDurationMs,
          },
        };
      }

      if (turn.toolCalls.length > maxToolCallsPerStep) {
        throw new AIError(
          "AI_PROVIDER_INVALID_RESPONSE",
          "El proveedor excedió el máximo de tools por paso",
        );
      }

      const seenCallIds = new Set<string>();
      const results: AIProviderInput[] = [];
      let directResponse: string | null = null;
      for (const call of turn.toolCalls) {
        if (!call.id || seenCallIds.has(call.id)) {
          throw new AIError(
            "AI_PROVIDER_INVALID_RESPONSE",
            "El proveedor devolvió un call id inválido",
          );
        }
        seenCallIds.add(call.id);

        const tool = toolByName.get(call.name);
        if (!tool) {
          throw new AIError(
            "AI_TOOL_NOT_ALLOWED",
            `Tool no autorizada: ${call.name}`,
          );
        }

        try {
          const output = await executeWithTimeout(
            () =>
              tool.execute(call.arguments, {
                ...input.context,
                signal: timeout.signal,
              }),
            timeout.signal,
          );
          toolsUsed.add(call.name);
          results.push({ type: "tool_result", callId: call.id, output });

          if (turn.toolCalls.length === 1 && tool.directResponse) {
            const rendered = tool.directResponse({
              message,
              history: input.history ?? [],
              argumentsValue: call.arguments,
              output,
              context: input.context,
            });
            if (rendered?.trim()) {
              directResponse = rendered.trim();
            }
          }
        } catch (error) {
          if (error instanceof AIError) throw error;
          throw new AIError("AI_TOOL_FAILED", `Falló la tool ${call.name}`, {
            cause: error,
          });
        }
      }
      if (directResponse) {
        return {
          text: directResponse,
          toolsUsed: Array.from(toolsUsed),
          usage,
          steps: step,
          route: {
            requestedProvider: input.provider.id,
            requestedModel: input.provider.model,
            effectiveProvider,
            effectiveModel,
            fallbackUsed,
            providerDurationMs,
          },
        };
      }

      providerInput = results;
    }

    throw new AIError(
      "AI_MAX_STEPS",
      "La solicitud excedió el máximo de pasos de tools",
    );
  } finally {
    timeout.clear();
  }
}
