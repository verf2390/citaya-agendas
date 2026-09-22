import { AIError } from "@/lib/ai/errors";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderTurn,
  AIUsage,
} from "@/lib/ai/types";

type LocalGatewayResponse = {
  text?: unknown;
  toolCalls?: Array<{ id?: unknown; name?: unknown; arguments?: unknown }>;
  continuation?: unknown;
  usage?: Partial<AIUsage>;
};

function safeTokenCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function validateEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AIError("AI_PROVIDER_CONFIG", "Endpoint local inválido");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new AIError(
      "AI_PROVIDER_CONFIG",
      "El endpoint local debe usar HTTPS o loopback HTTP",
    );
  }
  return url.toString();
}

export class LocalModelProvider implements AIProvider {
  readonly id = "local" as const;
  readonly model: string;
  private readonly endpoint: string;
  private readonly authToken: string;

  constructor(input: { endpoint: string; model: string; authToken?: string }) {
    this.endpoint = validateEndpoint(input.endpoint.trim());
    this.model = input.model.trim();
    this.authToken = input.authToken?.trim() ?? "";
    if (!this.model) {
      throw new AIError("AI_PROVIDER_CONFIG", "El proveedor local requiere modelo");
    }
  }

  async generate(request: AIProviderRequest): Promise<AIProviderTurn> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (this.authToken) headers.set("Authorization", `Bearer ${this.authToken}`);

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contractVersion: "citaya-ai-provider-v1",
          model: this.model,
          instructions: request.instructions,
          input: request.input,
          tools: request.tools,
          maxOutputTokens: request.maxOutputTokens,
          continuation: request.continuation ?? null,
        }),
        cache: "no-store",
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      throw new AIError(
        "AI_PROVIDER_UNAVAILABLE",
        "No se pudo contactar al modelo local",
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new AIError(
        "AI_PROVIDER_UNAVAILABLE",
        `El modelo local respondió HTTP ${response.status}`,
      );
    }

    let payload: LocalGatewayResponse;
    try {
      payload = (await response.json()) as LocalGatewayResponse;
    } catch (error) {
      throw new AIError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "El modelo local devolvió una respuesta inválida",
        { cause: error },
      );
    }

    const toolCalls = Array.isArray(payload.toolCalls)
      ? payload.toolCalls.map((call) => ({
          id: String(call.id ?? ""),
          name: String(call.name ?? ""),
          arguments: call.arguments,
        }))
      : [];

    return {
      text: typeof payload.text === "string" ? payload.text : "",
      toolCalls,
      continuation: payload.continuation,
      usage: {
        inputTokens: safeTokenCount(payload.usage?.inputTokens),
        outputTokens: safeTokenCount(payload.usage?.outputTokens),
        totalTokens: safeTokenCount(payload.usage?.totalTokens),
      },
    };
  }
}
