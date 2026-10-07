import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const page = readFileSync(resolve("app/admin/videos/page.tsx"), "utf8");
const nav = readFileSync(resolve("components/admin/AdminNav.tsx"), "utf8");

test("Video Studio navigation is visible only for rg-spa", () => {
  assert.match(nav, /href: "\/admin\/videos"/);
  assert.match(nav, /label: "Videos"/);
  assert.match(nav, /tenantOnly: "rg-spa"/);
  assert.match(nav, /item\.tenantOnly === tenant\?\.slug/);
});

test("Video Studio UI exposes the reviewed production flow", () => {
  for (const marker of [
    "create_from_brief",
    "Subir material",
    "Guardar edición",
    "Generar preview",
    "Aprobar preview",
    "Generar final 1080p",
    "Descargar MP4",
  ]) {
    assert.match(page, new RegExp(marker));
  }
  assert.match(page, /rightsApproved/);
  assert.match(page, /mediaApproved/);
  assert.match(page, /Idempotency-Key/);
});

test("Video Studio UI uses authenticated adminFetch without tenant hints", () => {
  assert.match(page, /adminFetch/);
  assert.doesNotMatch(page, /tenantId\s*:/);
  assert.doesNotMatch(page, /userId\s*:/);
  assert.doesNotMatch(page, /fetch\("/);
});
