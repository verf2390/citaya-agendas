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

const { resolveDirectReadIntent } = await import(
  pathToFileURL(resolve("lib/ai/server/direct-read-intent.ts")).href
);

test("router directo envía saldo pendiente a get_pending_receivables", () => {
  assert.deepEqual(resolveDirectReadIntent("¿Cuánto tengo pendiente por cobrar?"), {
    toolName: "get_pending_receivables",
    argumentsValue: { limit: 50 },
  });

  assert.deepEqual(resolveDirectReadIntent("Muéstrame los saldos pendientes"), {
    toolName: "get_pending_receivables",
    argumentsValue: { limit: 50 },
  });
});

test("router directo no intercepta solicitudes generativas", () => {
  assert.equal(
    resolveDirectReadIntent(
      "Analiza mis pagos pendientes y recomiéndame una estrategia de cobro",
    ),
    null,
  );
  assert.equal(
    resolveDirectReadIntent("Redáctame un mensaje para cobrar saldos pendientes"),
    null,
  );
});

test("router directo no captura preguntas no relacionadas", () => {
  assert.equal(resolveDirectReadIntent("¿Cuántas reservas tengo mañana?"), null);
  assert.equal(
    resolveDirectReadIntent("Muéstrame clientes inactivos de 60 días"),
    null,
  );
});
