import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve("lib/ai/server/citaya-app-assistant.ts"),
  "utf8",
);

test("redacción autocontenida usa prompt liviano sin tools ni historial previo", () => {
  assert.match(source, /const pureDrafting = isPureDraftingRequest\(input\.message\)/);
  assert.match(source, /buildCitayaAppDraftingInstructions/);
  assert.match(source, /history: pureDrafting \? undefined : input\.history/);
  assert.match(source, /tools: pureDrafting \? \[\] : tools/);
  assert.match(source, /Math\.min\(input\.policy\.maxOutputTokens, 64\)/);
});

test("consejo autocontenido usa ruta liviana y cap de salida", () => {
  assert.match(source, /const pureAdvisory = isPureAdvisoryRequest\(input\.message\)/);
  assert.match(source, /buildCitayaAppAdvisoryInstructions/);
  assert.match(source, /const lightweight = pureDrafting \|\| pureAdvisory/);
  assert.match(source, /history: lightweight \? undefined : input\.history/);
  assert.match(source, /tools: lightweight \? \[\] : tools/);
  assert.match(source, /Math\.min\(input\.policy\.maxOutputTokens, 128\)/);
});

test("ruta administrativa completa permanece disponible para solicitudes con datos", () => {
  assert.match(source, /buildCitayaAppAssistantInstructions/);
  assert.match(source, /tenantSlug: input\.tenantSlug/);
});
