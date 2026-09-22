import { AIError } from "@/lib/ai/errors";
import type {
  AICoreResult,
  AIConversationMessage,
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
  const toolsUsed = new Set<string>();

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      let turn;
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
      }

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
        } catch (error) {
          if (error instanceof AIError) throw error;
          throw new AIError("AI_TOOL_FAILED", `Falló la tool ${call.name}`, {
            cause: error,
          });
        }
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
