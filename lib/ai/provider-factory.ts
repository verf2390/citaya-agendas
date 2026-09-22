import { AIError } from "@/lib/ai/errors";
import { HybridAIProvider } from "@/lib/ai/providers/hybrid";
import { LocalModelProvider } from "@/lib/ai/providers/local";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import type { AIProvider, AIProviderId } from "@/lib/ai/types";

if (typeof window !== "undefined") {
  throw new Error("Citaya AI providers are server-only");
}

export function createAIProvider(input: {
  provider: AIProviderId;
  model: string;
}): AIProvider {
  if (input.provider === "openai") {
    return new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: input.model,
      endpoint: process.env.CITAYA_AI_OPENAI_ENDPOINT,
    });
  }

  const createLocal = (model: string) =>
    new LocalModelProvider({
      endpoint: process.env.CITAYA_AI_LOCAL_ENDPOINT ?? "",
      model,
      authToken: process.env.CITAYA_AI_LOCAL_AUTH_TOKEN,
      allowPrivateHttp:
        process.env.CITAYA_AI_LOCAL_ALLOW_HTTP_PRIVATE?.trim().toLowerCase() ===
        "true",
    });

  if (input.provider === "local") {
    return createLocal(input.model);
  }

  if (input.provider === "hybrid") {
    const fallbackModel = process.env.CITAYA_AI_OPENAI_MODEL?.trim() ?? "";
    const primaryTimeoutMs = Number(
      process.env.CITAYA_AI_HYBRID_PRIMARY_TIMEOUT_MS ?? 5_000,
    );
    return new HybridAIProvider(
      createLocal(input.model),
      new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY ?? "",
        model: fallbackModel,
        endpoint: process.env.CITAYA_AI_OPENAI_ENDPOINT,
      }),
      primaryTimeoutMs,
    );
  }

  throw new AIError("AI_PROVIDER_CONFIG", "Proveedor de IA no soportado");
}
