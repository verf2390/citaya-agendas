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
  isPureAdvisoryRequest,
  isPureDraftingRequest,
  resolveDirectReadIntent,
} = await import(
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

test("router directo no convierte recordatorios en consultas de reservas", () => {
  const context = {
    now: new Date("2026-09-26T19:30:00Z"),
    timezone: "America/Santiago",
  };

  assert.equal(
    resolveDirectReadIntent(
      "Haz un recordatorio breve y cordial para una cita de mañana",
      context,
    ),
    null,
  );
  assert.equal(
    resolveDirectReadIntent(
      "Escribe un borrador para recordar la cita de mañana",
      context,
    ),
    null,
  );
});

test("router directo resuelve reservas de hoy y mañana con fecha local confiable", () => {
  const context = {
    now: new Date("2026-09-26T19:30:00Z"),
    timezone: "America/Santiago",
  };

  assert.deepEqual(
    resolveDirectReadIntent("¿Cuántas reservas tengo mañana?", context),
    {
      toolName: "count_appointments",
      argumentsValue: { date: "2026-09-27" },
    },
  );

  assert.deepEqual(
    resolveDirectReadIntent("¿Cuántas citas tengo hoy?", context),
    {
      toolName: "count_appointments",
      argumentsValue: { date: "2026-09-26" },
    },
  );
});

test("router directo no captura preguntas no relacionadas", () => {
  assert.equal(
    resolveDirectReadIntent("Muéstrame clientes inactivos de 60 días"),
    null,
  );
});


test("clasifica redacción autocontenida para ruta liviana", () => {
  assert.equal(
    isPureDraftingRequest(
      "Redáctame un recordatorio breve y cordial para una cita de mañana",
    ),
    true,
  );
  assert.equal(
    isPureDraftingRequest("Redáctame un mensaje para recuperar clientes inactivos"),
    true,
  );
});

test("no usa ruta liviana cuando la redacción depende de datos o contexto previo", () => {
  assert.equal(
    isPureDraftingRequest(
      "Redáctame un mensaje basado en mis clientes inactivos",
    ),
    false,
  );
  assert.equal(
    isPureDraftingRequest("Redacta lo mismo pero más corto"),
    false,
  );
  assert.equal(
    isPureDraftingRequest("Redáctame un mensaje con esos datos"),
    false,
  );
});


test("clasifica consejo autocontenido para ruta liviana", () => {
  assert.equal(
    isPureAdvisoryRequest(
      "Tengo una barbería y quiero recuperar clientes que llevan más de 60 días sin volver, pero no quiero ofrecer descuentos. Dame 3 acciones concretas, ordénalas por prioridad y explica brevemente por qué harías cada una.",
    ),
    true,
  );
  assert.equal(
    isPureAdvisoryRequest(
      "Dame 3 acciones para recuperar clientes sin ofrecer descuentos",
    ),
    true,
  );
});

test("consejo basado en datos reales mantiene la ruta completa", () => {
  assert.equal(
    isPureAdvisoryRequest(
      "Analiza mis clientes inactivos y recomiéndame 3 acciones",
    ),
    false,
  );
  assert.equal(
    isPureAdvisoryRequest(
      "Según estos datos, dame un plan para recuperar clientes",
    ),
    false,
  );
});
