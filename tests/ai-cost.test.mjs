import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return {
        url: pathToFileURL(resolve(`${specifier.slice(2)}.ts`)).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  estimateAIRequestCost,
  parseAIPriceCatalog,
} = await import(
  pathToFileURL(resolve("lib/ai/server/cost.ts")).href
);

const usage = {
  inputTokens: 1_000,
  outputTokens: 500,
  totalTokens: 1_500,
};

test("AI cost deja requests sin precio cuando no existe catálogo", () => {
  assert.deepEqual(
    estimateAIRequestCost({
      provider: "openai",
      model: "cloud-test",
      usage,
      catalog: null,
    }),
    {
      priced: false,
      pricingVersion: null,
      currency: "USD",
      provider: "openai",
      model: "cloud-test",
      reason: "missing_catalog",
    },
  );
});

test("AI cost calcula input/output en micro-USD con catálogo versionado", () => {
  const catalog = parseAIPriceCatalog(
    JSON.stringify({
      version: "test-2026-10",
      currency: "USD",
      models: [
        {
          provider: "openai",
          model: "cloud-test",
          inputUsdPerMillionTokens: 1.25,
          outputUsdPerMillionTokens: 10,
        },
      ],
    }),
  );

  assert.deepEqual(
    estimateAIRequestCost({
      provider: "openai",
      model: "cloud-test",
      usage,
      catalog,
    }),
    {
      priced: true,
      pricingVersion: "test-2026-10",
      currency: "USD",
      provider: "openai",
      model: "cloud-test",
      inputCostMicrosUsd: 1_250,
      outputCostMicrosUsd: 5_000,
      totalCostMicrosUsd: 6_250,
    },
  );
});

test("AI cost exige coincidencia exacta de provider y modelo", () => {
  const catalog = parseAIPriceCatalog(
    JSON.stringify({
      version: "test-v1",
      currency: "USD",
      models: [
        {
          provider: "openai",
          model: "cloud-test",
          inputUsdPerMillionTokens: 1,
          outputUsdPerMillionTokens: 2,
        },
      ],
    }),
  );

  const estimate = estimateAIRequestCost({
    provider: "local",
    model: "cloud-test",
    usage,
    catalog,
  });

  assert.equal(estimate.priced, false);
  assert.equal(estimate.reason, "missing_model_price");
  assert.equal(estimate.pricingVersion, "test-v1");
});

test("AI pricing rechaza entradas duplicadas o tarifas inválidas", () => {
  assert.throws(
    () =>
      parseAIPriceCatalog(
        JSON.stringify({
          version: "test-v1",
          currency: "USD",
          models: [
            {
              provider: "openai",
              model: "same",
              inputUsdPerMillionTokens: 1,
              outputUsdPerMillionTokens: 2,
            },
            {
              provider: "openai",
              model: "same",
              inputUsdPerMillionTokens: 1,
              outputUsdPerMillionTokens: 2,
            },
          ],
        }),
      ),
    (error) => error?.code === "AI_PROVIDER_CONFIG",
  );

  assert.throws(
    () =>
      parseAIPriceCatalog(
        JSON.stringify({
          version: "test-v1",
          currency: "USD",
          models: [
            {
              provider: "local",
              model: "local-test",
              inputUsdPerMillionTokens: -1,
              outputUsdPerMillionTokens: 0,
            },
          ],
        }),
      ),
    (error) => error?.code === "AI_PROVIDER_CONFIG",
  );
});
