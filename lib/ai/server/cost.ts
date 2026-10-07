import { AIError } from "@/lib/ai/errors";
import type { AIEffectiveProviderId, AIUsage } from "@/lib/ai/types";

if (typeof window !== "undefined") {
  throw new Error("AI pricing is server-only");
}

export type AIModelPrice = {
  provider: AIEffectiveProviderId;
  model: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type AIPriceCatalog = {
  version: string;
  currency: "USD";
  models: AIModelPrice[];
};

export type AICostEstimate =
  | {
      priced: true;
      pricingVersion: string;
      currency: "USD";
      provider: AIEffectiveProviderId;
      model: string;
      inputCostMicrosUsd: number;
      outputCostMicrosUsd: number;
      totalCostMicrosUsd: number;
    }
  | {
      priced: false;
      pricingVersion: string | null;
      currency: "USD";
      provider: AIEffectiveProviderId;
      model: string;
      reason: "missing_catalog" | "missing_model_price";
    };

const MAX_MODELS = 100;
const MAX_USD_PER_MILLION_TOKENS = 10_000;

function pricingConfigError(message: string, cause?: unknown): never {
  throw new AIError(
    "AI_PROVIDER_CONFIG",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") {
    pricingConfigError(`Configuración de precios IA inválida: ${field}`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    pricingConfigError(`Configuración de precios IA inválida: ${field}`);
  }
  return text;
}

function priceRate(value: unknown, field: string) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_USD_PER_MILLION_TOKENS
  ) {
    pricingConfigError(`Configuración de precios IA inválida: ${field}`);
  }
  return value;
}

function provider(value: unknown): AIEffectiveProviderId {
  if (value !== "openai" && value !== "local") {
    pricingConfigError("Configuración de precios IA inválida: provider");
  }
  return value;
}

export function parseAIPriceCatalog(value: string): AIPriceCatalog {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch (error) {
    pricingConfigError("CITAYA_AI_PRICING_JSON no contiene JSON válido", error);
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    pricingConfigError("CITAYA_AI_PRICING_JSON debe ser un objeto");
  }

  const object = raw as Record<string, unknown>;
  const version = requiredString(object.version, "version", 64);
  if (!/^[A-Za-z0-9._:-]+$/.test(version)) {
    pricingConfigError("Configuración de precios IA inválida: version");
  }
  if (object.currency !== "USD") {
    pricingConfigError("La moneda de precios IA debe ser USD");
  }
  if (
    !Array.isArray(object.models) ||
    object.models.length < 1 ||
    object.models.length > MAX_MODELS
  ) {
    pricingConfigError("Configuración de precios IA inválida: models");
  }

  const seen = new Set<string>();
  const models = object.models.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      pricingConfigError(
        `Configuración de precios IA inválida: models[${index}]`,
      );
    }

    const row = item as Record<string, unknown>;
    const effectiveProvider = provider(row.provider);
    const model = requiredString(row.model, `models[${index}].model`, 120);
    const key = `${effectiveProvider}:\0${model}`;
    if (seen.has(key)) {
      pricingConfigError(
        `Configuración de precios IA duplicada para ${effectiveProvider}/${model}`,
      );
    }
    seen.add(key);

    return {
      provider: effectiveProvider,
      model,
      inputUsdPerMillionTokens: priceRate(
        row.inputUsdPerMillionTokens,
        `models[${index}].inputUsdPerMillionTokens`,
      ),
      outputUsdPerMillionTokens: priceRate(
        row.outputUsdPerMillionTokens,
        `models[${index}].outputUsdPerMillionTokens`,
      ),
    };
  });

  return {
    version,
    currency: "USD",
    models,
  };
}

export function loadAIPriceCatalogFromEnv(): AIPriceCatalog | null {
  const value = process.env.CITAYA_AI_PRICING_JSON?.trim();
  return value ? parseAIPriceCatalog(value) : null;
}

function assertUsage(usage: AIUsage) {
  for (const [field, value] of [
    ["inputTokens", usage.inputTokens],
    ["outputTokens", usage.outputTokens],
    ["totalTokens", usage.totalTokens],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      pricingConfigError(`Uso IA inválido para costo: ${field}`);
    }
  }
}

function microsUsd(tokens: number, usdPerMillionTokens: number) {
  const value = Math.round(tokens * usdPerMillionTokens);
  if (!Number.isSafeInteger(value) || value < 0) {
    pricingConfigError("El costo estimado de IA excede el rango permitido");
  }
  return value;
}

export function estimateAIRequestCost(input: {
  provider: AIEffectiveProviderId;
  model: string;
  usage: AIUsage;
  catalog?: AIPriceCatalog | null;
}): AICostEstimate {
  assertUsage(input.usage);
  const model = input.model.trim();
  if (!model || model.length > 120) {
    pricingConfigError("Modelo IA inválido para estimar costo");
  }

  const catalog =
    input.catalog === undefined ? loadAIPriceCatalogFromEnv() : input.catalog;

  if (!catalog) {
    return {
      priced: false,
      pricingVersion: null,
      currency: "USD",
      provider: input.provider,
      model,
      reason: "missing_catalog",
    };
  }

  const price = catalog.models.find(
    (item) => item.provider === input.provider && item.model === model,
  );
  if (!price) {
    return {
      priced: false,
      pricingVersion: catalog.version,
      currency: "USD",
      provider: input.provider,
      model,
      reason: "missing_model_price",
    };
  }

  const inputCostMicrosUsd = microsUsd(
    input.usage.inputTokens,
    price.inputUsdPerMillionTokens,
  );
  const outputCostMicrosUsd = microsUsd(
    input.usage.outputTokens,
    price.outputUsdPerMillionTokens,
  );
  const totalCostMicrosUsd = inputCostMicrosUsd + outputCostMicrosUsd;

  if (!Number.isSafeInteger(totalCostMicrosUsd)) {
    pricingConfigError("El costo total estimado de IA excede el rango permitido");
  }

  return {
    priced: true,
    pricingVersion: catalog.version,
    currency: "USD",
    provider: input.provider,
    model,
    inputCostMicrosUsd,
    outputCostMicrosUsd,
    totalCostMicrosUsd,
  };
}
