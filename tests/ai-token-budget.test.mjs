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

const { reservedTokensForAIRequest } = await import(
  pathToFileURL(resolve("lib/ai/server/token-budget.ts")).href
);

test("la reserva nunca excede el presupuesto diario del tenant", () => {
  assert.equal(
    reservedTokensForAIRequest({
      dailyTokenLimit: 3_000,
      maxOutputTokens: 800,
    }),
    3_000,
  );
});

test("la reserva conserva el margen de entrada para presupuestos normales", () => {
  assert.equal(
    reservedTokensForAIRequest({
      dailyTokenLimit: 50_000,
      maxOutputTokens: 800,
    }),
    4_800,
  );
});
