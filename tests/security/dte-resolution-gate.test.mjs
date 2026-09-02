import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("legal activation requires explicit plausible SII resolution date and number", () => {
  const migration = read("migrations/202607280001_dte_sii_resolution_gate.sql");
  for (const field of [
    "issuerResolutionConfigured",
    "resolution_date",
    "resolution_number",
    "SII_RESOLUTION_INCOMPLETE",
  ]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(migration, /resolution_date <= current_date/);
  assert.match(migration, /\^\[1-9\]\[0-9\]\{0,9\}\$/);
  assert.match(migration, /set status = 'paused'/);
  assert.match(migration, /set production_enabled = false/);
  assert.match(migration, /alter column sii_office drop not null/);
  assert.match(migration, /SII office is optional audit metadata/);
  assert.doesNotMatch(
    migration,
    /issuerResolutionConfigured[\s\S]{0,300}sii_office/,
  );
  assert.doesNotMatch(migration, /delete from|truncate|drop table/i);
});

test("official local EnvioDTE requires resolution fields but no SII office", () => {
  const xsd = read("docs/dte-sii/xsd/EnvioDTE_v10.xsd");
  assert.match(xsd, /<xs:element name="FchResol"/);
  assert.match(xsd, /<xs:element name="NroResol"/);
  assert.doesNotMatch(xsd, /sii_office|SiiOffice|Oficina/i);
});

test("authorization evidence preserves official non-engine types", () => {
  const migration = read("migrations/202607280001_dte_sii_resolution_gate.sql");
  assert.match(migration, /array\[33,34,39,52,56,61\]/);
  assert.match(migration, /'documentEngineReady', p_dte_type in \(33,56,61\)/);
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
