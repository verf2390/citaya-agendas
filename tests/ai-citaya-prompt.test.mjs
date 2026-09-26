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

const { buildCitayaAppAssistantInstructions } = await import(
  pathToFileURL(resolve("lib/ai/prompts/citaya-app-v1.ts")).href
);

test("prompt de Citaya trata recordatorios como redacción y no consulta negocio por defecto", () => {
  const instructions = buildCitayaAppAssistantInstructions({
    now: new Date("2026-09-26T19:30:00Z"),
    timezone: "America/Santiago",
    tenantSlug: "demo",
  });

  assert.match(instructions, /genera directamente el texto solicitado/i);
  assert.match(
    instructions,
    /No consultes reservas, clientes ni pagos salvo que el usuario pida explícitamente/i,
  );
  assert.match(
    instructions,
    /No pidas una fecha solo para redactar un mensaje si el usuario ya dijo "hoy" o "mañana"/i,
  );
  assert.match(
    instructions,
    /una aclaración posterior sobre fecha, tono o contenido sigue siendo parte de esa redacción/i,
  );
  assert.match(instructions, /Fecha local actual: 2026-09-26/);
});
