import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const page = readFileSync(resolve("app/admin/asistente/page.tsx"), "utf8");
const nav = readFileSync(resolve("components/admin/AdminNav.tsx"), "utf8");

test("panel expone el asistente y comunica el modo solo lectura", () => {
  assert.match(nav, /href: "\/admin\/asistente"/);
  assert.match(page, /Solo lectura/);
  assert.match(page, /no envía, cobra ni modifica reservas/i);
});

test("UI envía solo mensaje e historial visible, nunca tenant hints", () => {
  const requestStart = page.indexOf('"/api/admin/ai/assistant"');
  assert.notEqual(requestStart, -1);
  const requestEnd = page.indexOf(
    "AI_ASSISTANT_CLIENT_TIMEOUT_MS",
    requestStart,
  );
  assert.notEqual(requestEnd, -1);
  const requestBlock = page.slice(requestStart, requestEnd);
  assert.match(requestBlock, /message: value/);
  assert.match(requestBlock, /history: messages/);
  assert.doesNotMatch(requestBlock, /tenantId|tenantSlug/);
});


test("UI muestra telemetría agregada sin exponer prompts", () => {
  assert.match(page, /Uso de IA · 7 días/);
  assert.match(page, /Telemetría agregada; no incluye prompts ni respuestas/);
  assert.match(page, /localRequests/);
  assert.match(page, /cloudRequests/);
  assert.match(page, /fallbackRequests/);
  assert.match(page, /cloudTokens/);
});


test("UI da al endpoint IA más tiempo que el timeout cliente global", () => {
  assert.match(page, /AI_ASSISTANT_CLIENT_TIMEOUT_MS = 40_000/);
  assert.match(
    page,
    /adminFetch\([\s\S]*\/api\/admin\/ai\/assistant[\s\S]*AI_ASSISTANT_CLIENT_TIMEOUT_MS/,
  );
});
