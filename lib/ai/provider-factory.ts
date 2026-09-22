import { AIError } from "@/lib/ai/errors";
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

  if (input.provider === "local") {
    return new LocalModelProvider({
      endpoint: process.env.CITAYA_AI_LOCAL_ENDPOINT ?? "",
      model: input.model,
      authToken: process.env.CITAYA_AI_LOCAL_AUTH_TOKEN,
    });
  }

  throw new AIError("AI_PROVIDER_CONFIG", "Proveedor de IA no soportado");
}
