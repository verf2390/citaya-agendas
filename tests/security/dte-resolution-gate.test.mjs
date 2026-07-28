import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("legal activation requires explicit plausible SII resolution metadata", () => {
  const migration = read("migrations/202607280001_dte_sii_resolution_gate.sql");
  for (const field of [
    "issuerResolutionConfigured",
    "resolution_date",
    "resolution_number",
    "sii_office",
    "SII_RESOLUTION_INCOMPLETE",
  ]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(migration, /resolution_date <= current_date/);
  assert.match(migration, /\^\[1-9\]\[0-9\]\{0,9\}\$/);
  assert.match(migration, /set status = 'paused'/);
  assert.match(migration, /set production_enabled = false/);
  assert.doesNotMatch(migration, /delete from|truncate|drop table/i);
});

test("runtime rejects missing SII resolution before artifact generation", () => {
  const service = read("lib/dte/production/service.ts");
  const generator = read("lib/dte/production/generator.ts");
  const validator = read("lib/dte/production/issuer-settings.ts");
  assert.match(service, /assertValidProductionIssuerResolution/);
  assert.match(generator, /assertValidProductionIssuerResolution/);
  assert.match(validator, /DTE_PRODUCTION_SII_RESOLUTION_INVALID/);
});

test("manual intents and notes require the complete activation gate", () => {
  for (const path of [
    "app/api/admin/dte-intents/manual/route.ts",
    "app/api/admin/dte-intents/[id]/note/route.ts",
  ]) {
    const route = read(path);
    assert.match(route, /dte_activation_gate_report/);
    assert.match(route, /gate\?\.ready === true/);
    assert.match(route, /activation\?\.status === "active"/);
  }
});
