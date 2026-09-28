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

const { proposeCitayaAppActions } = await import(
  pathToFileURL(resolve("lib/ai/actions/citaya-app-actions.ts")).href
);

test("propone borrador de campaña con confirmación humana obligatoria", () => {
  const actions = proposeCitayaAppActions({
    message: "Redáctame un mensaje para recuperar clientes inactivos.",
    answer: "Hola, hace tiempo que no te vemos. Reserva tu próxima hora.",
  });

  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], {
    id: "campaign_draft_v1",
    kind: "campaign_draft",
    title: "Revisar borrador en Campañas",
    summary:
      "Abre el editor de campañas para revisar el borrador antes de cualquier envío.",
    requiresConfirmation: true,
    target: { path: "/admin/campanas" },
    preview: {
      message: "Hola, hace tiempo que no te vemos. Reserva tu próxima hora.",
    },
  });
});

test("no convierte redacción general en acción de campaña", () => {
  assert.deepEqual(
    proposeCitayaAppActions({
      message: "Redáctame un recordatorio breve para una cita de mañana.",
      answer: "Hola, te recordamos tu cita de mañana.",
    }),
    [],
  );
});

test("una propuesta nunca contiene instrucciones de autoejecución", () => {
  const actions = proposeCitayaAppActions({
    message: "Crea una campaña para recuperar clientes.",
    answer: "Te esperamos nuevamente.",
  });
  const serialized = JSON.stringify(actions);

  assert.equal(actions[0]?.requiresConfirmation, true);
  assert.equal(serialized.includes("autoExecute"), false);
  assert.equal(serialized.includes("sendAutomatically"), false);
});
