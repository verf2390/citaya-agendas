import { AIError } from "@/lib/ai/errors";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderTurn,
} from "@/lib/ai/types";

type SelectedProvider = "primary" | "fallback" | null;

function isRetriableFirstTurnFailure(error: unknown) {
  return (
    error instanceof AIError &&
    (error.code === "AI_PROVIDER_UNAVAILABLE" ||
      error.code === "AI_PROVIDER_INVALID_RESPONSE")
  );
}

export class HybridAIProvider implements AIProvider {
  readonly id = "hybrid" as const;
  readonly model: string;
  private readonly primary: AIProvider;
  private readonly fallback: AIProvider;
  private readonly primaryTimeoutMs: number;
  private selected: SelectedProvider = null;

  constructor(
    primary: AIProvider,
    fallback: AIProvider,
    primaryTimeoutMs: number,
  ) {
    this.primary = primary;
    this.fallback = fallback;
    this.primaryTimeoutMs = primaryTimeoutMs;
    this.model = primary.model;
    if (!Number.isInteger(primaryTimeoutMs) || primaryTimeoutMs < 250) {
      throw new AIError(
        "AI_PROVIDER_CONFIG",
        "El timeout primario híbrido no es válido",
      );
    }
  }

  async generate(request: AIProviderRequest): Promise<AIProviderTurn> {
    if (this.selected === "primary") {
      const turn = await this.primary.generate(request);
      return {
        ...turn,
        route: {
          effectiveProvider: this.primary.id === "openai" ? "openai" : "local",
          effectiveModel: this.primary.model,
          fallbackUsed: false,
        },
      };
    }
    if (this.selected === "fallback") {
      const turn = await this.fallback.generate(request);
      return {
        ...turn,
        route: {
          effectiveProvider: this.fallback.id === "local" ? "local" : "openai",
          effectiveModel: this.fallback.model,
          fallbackUsed: true,
        },
      };
    }

    // The provider is sticky for the rest of the tool loop. We only switch
    // before the first successful turn so provider-specific continuation state
    // never crosses from local to cloud or vice versa.
    if (request.continuation !== undefined) {
      throw new AIError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "No se puede seleccionar fallback con una continuación existente",
      );
    }

    const controller = new AbortController();
    let primaryTimedOut = false;
    const onParentAbort = () => controller.abort();
    request.signal.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => {
      primaryTimedOut = true;
      controller.abort();
    }, this.primaryTimeoutMs);

    try {
      const turn = await this.primary.generate({
        ...request,
        signal: controller.signal,
      });
      this.selected = "primary";
      return {
        ...turn,
        route: {
          effectiveProvider: this.primary.id === "openai" ? "openai" : "local",
          effectiveModel: this.primary.model,
          fallbackUsed: false,
        },
      };
    } catch (error) {
      if (request.signal.aborted) throw error;
      if (!primaryTimedOut && !isRetriableFirstTurnFailure(error)) throw error;

      const turn = await this.fallback.generate(request);
      this.selected = "fallback";
      return {
        ...turn,
        route: {
          effectiveProvider: this.fallback.id === "local" ? "local" : "openai",
          effectiveModel: this.fallback.model,
          fallbackUsed: true,
        },
      };
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onParentAbort);
    }
  }
}
