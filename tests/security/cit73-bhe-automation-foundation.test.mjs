import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "migrations/202609090003_cit73_bhe_automation_foundation.sql",
  "utf8",
);
const docs = readFileSync("docs/bhe/automatic-emission.md", "utf8");
const capabilityMigration = readFileSync(
  "migrations/202609090007_cit73_bhe_automation_capability.sql",
  "utf8",
);
const operationalTypes = readFileSync(
  "lib/tenant/operational-types.ts",
  "utf8",
);
const operationalServer = readFileSync(
  "lib/tenant/operational-server.ts",
  "utf8",
);

test("CIT-73 BHE automation is explicit and fail closed", () => {
  assert.match(migration, /tenant_bhe_automation_settings/);
  assert.match(migration, /automation_mode text not null default 'external_manual'/);
  assert.match(migration, /authorization_status text not null default 'not_configured'/);
  assert.match(migration, /automation_enabled boolean not null default false/);
  assert.match(migration, /tenant_bhe_automation_enablement_shape/);
  assert.match(migration, /authorization_status = 'authorized'/);
  assert.match(migration, /provider_included_in_certification/);
  assert.match(migration, /ws_spec_received/);
  assert.match(migration, /credentials_configured/);
  assert.match(migration, /worker_ready/);
});

test("CIT-73 models the official volume and simultaneity eligibility paths", () => {
  assert.match(migration, /'volume_300_plus'/);
  assert.match(migration, /average_monthly_bhe >= 300/);
  assert.match(migration, /evidence_period_months = 6/);
  assert.match(migration, /'simultaneity_case'/);
  assert.match(migration, /eligibility_evidence_reference/);
});

test("CIT-73 does not invent SII transport credentials or endpoints", () => {
  assert.doesNotMatch(migration, /https?:\/\//i);

  const settingsStart = migration.indexOf(
    "create table if not exists public.tenant_bhe_automation_settings",
  );
  const settingsEnd = migration.indexOf(
    "alter table public.tenant_bhe_automation_settings",
    settingsStart,
  );
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
  const settingsSchema = migration.slice(settingsStart, settingsEnd);

  // Inspect actual schema identifiers instead of prose comments such as
  // "contains no transport secrets". No transport credential material belongs
  // in this foundation; only boolean readiness/evidence state is modeled.
  assert.doesNotMatch(
    settingsSchema,
    /\b(?:password|secret|private_key|access_token|wsdl_url)\b\s+(?:text|varchar|bytea|jsonb?)/i,
  );
  assert.match(docs, /No se implementarán endpoints, WSDL, formatos, tokens ni secretos inventados/);
});

test("CIT-73 keeps manual external BHE independent from automatic SII mass BHE", () => {
  assert.match(migration, /'external_manual','sii_mass_webservice'/);
  assert.match(docs, /tax_document_mode = external_bhe/);
  assert.match(docs, /Dimarzo no debe depender de la automatización BHE para pasar a `live`/);
});

test("CIT-73 readiness requires every automatic gate", () => {
  assert.match(migration, /tenant_bhe_automation_readiness/);
  const readiness = migration.slice(
    migration.indexOf("create or replace function public.tenant_bhe_automation_readiness"),
  );
  for (const gate of [
    "automation_enabled",
    "authorization_status='authorized'",
    "provider_included_in_certification",
    "ws_spec_received",
    "credentials_configured",
    "worker_ready",
  ]) {
    assert.match(readiness, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});


test("CIT-73 exposes a dedicated fail-closed bheAutomation capability", () => {
  assert.match(
    capabilityMigration,
    /tenant_bhe_automation_readiness\(p_tenant_id\)/,
  );

  assert.match(
    capabilityMigration,
    /'bheAutomation',\s*coalesce\(feature\.tax_document_mode,'unconfigured'\)='external_bhe'\s*and live_gates\.bhe_automation_ready/,
  );

  const disabledModes =
    capabilityMigration.match(/'bheAutomation',false/g) ?? [];

  assert.ok(
    disabledModes.length >= 5,
    `expected bheAutomation=false on non-live modes, got ${disabledModes.length}`,
  );

  assert.match(
    operationalTypes,
    /bheAutomation: boolean/,
  );

  assert.match(
    operationalServer,
    /typeof row\.bheAutomation === "boolean"/,
  );

  assert.match(
    operationalServer,
    /assertTenantCanAutomateBhe/,
  );

  assert.match(
    operationalServer,
    /"bheAutomation",\s*"TENANT_MODE_BHE_AUTOMATION_BLOCKED"/,
  );
});
