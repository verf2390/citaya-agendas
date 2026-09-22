import { AIError } from "@/lib/ai/errors";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderTurn,
  AIUsage,
} from "@/lib/ai/types";

type OpenAIContinuation = {
  input: unknown[];
  output: unknown[];
};

type OpenAIResponse = {
  output?: Array<Record<string, unknown>>;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

function numberOrZero(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function validateEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AIError("AI_PROVIDER_CONFIG", "Endpoint de OpenAI inválido");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new AIError(
      "AI_PROVIDER_CONFIG",
      "El endpoint de OpenAI debe usar HTTPS o loopback HTTP",
    );
  }
  return url.toString();
}

function usageFromResponse(response: OpenAIResponse): AIUsage {
  return {
    inputTokens: numberOrZero(response.usage?.input_tokens),
    outputTokens: numberOrZero(response.usage?.output_tokens),
    totalTokens: numberOrZero(response.usage?.total_tokens),
  };
}

function textFromOutput(response: OpenAIResponse) {
  if (typeof response.output_text === "string") return response.output_text;
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content as Array<Record<string, unknown>>) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n");
}

function parseArguments(value: unknown) {
  if (typeof value !== "string") {
    throw new AIError(
      "AI_PROVIDER_INVALID_RESPONSE",
      "OpenAI devolvió argumentos de tool inválidos",
    );
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new AIError(
      "AI_PROVIDER_INVALID_RESPONSE",
      "OpenAI devolvió JSON de tool inválido",
      { cause: error },
    );
  }
}

function isContinuation(value: unknown): value is OpenAIContinuation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OpenAIContinuation>;
  return Array.isArray(candidate.input) && Array.isArray(candidate.output);
}

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(input: { apiKey: string; model: string; endpoint?: string }) {
    this.apiKey = input.apiKey.trim();
    this.model = input.model.trim();
    this.endpoint = validateEndpoint(
      input.endpoint?.trim() || "https://api.openai.com/v1/responses",
    );
    if (!this.apiKey || !this.model) {
      throw new AIError(
        "AI_PROVIDER_CONFIG",
        "OpenAI requiere API key y modelo server-side",
      );
    }
  }

  async generate(request: AIProviderRequest): Promise<AIProviderTurn> {
    const previous = isContinuation(request.continuation)
      ? request.continuation
      : null;
    const nextInput: unknown[] = previous
      ? [...previous.input, ...previous.output]
      : [];

    for (const item of request.input) {
      if (item.type === "user" || item.type === "assistant") {
        nextInput.push({ role: item.type, content: item.text });
      } else {
        nextInput.push({
          type: "function_call_output",
          call_id: item.callId,
          output: JSON.stringify(item.output),
        });
      }
    }

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          instructions: request.instructions,
          input: nextInput,
          tools: request.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: true,
          })),
          tool_choice: "auto",
          parallel_tool_calls: false,
          max_output_tokens: request.maxOutputTokens,
          store: false,
          include: ["reasoning.encrypted_content"],
        }),
        cache: "no-store",
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      throw new AIError(
        "AI_PROVIDER_UNAVAILABLE",
        "No se pudo contactar a OpenAI",
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new AIError(
        "AI_PROVIDER_UNAVAILABLE",
        `OpenAI respondió HTTP ${response.status}`,
      );
    }

    let payload: OpenAIResponse;
    try {
      payload = (await response.json()) as OpenAIResponse;
    } catch (error) {
      throw new AIError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "OpenAI devolvió una respuesta inválida",
        { cause: error },
      );
    }

    const output = Array.isArray(payload.output) ? payload.output : [];
    const toolCalls = output
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        id: String(item.call_id ?? ""),
        name: String(item.name ?? ""),
        arguments: parseArguments(item.arguments),
      }));

    return {
      text: textFromOutput(payload),
      toolCalls,
      usage: usageFromResponse(payload),
      continuation: { input: nextInput, output } satisfies OpenAIContinuation,
    };
  }
}
