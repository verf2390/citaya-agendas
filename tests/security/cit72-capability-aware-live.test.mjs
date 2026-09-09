import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "migrations/202609090002_cit72_capability_aware_live.sql",
  "utf8",
);
const operationalServer = readFileSync(
  "lib/tenant/operational-server.ts",
  "utf8",
);
const publicLegalServer = readFileSync(
  "lib/legal/server.ts",
  "utf8",
);
const platformApi = readFileSync(
  "app/api/admin/platform/tenant-features/route.ts",
  "utf8",
);

test("CIT-72 stores an explicit fail-closed per-tenant feature profile", () => {
  assert.match(migration, /create table if not exists public\.tenant_operational_features/);
  for (const field of [
    "appointments_enabled",
    "appointment_communications_enabled",
    "external_communications_enabled",
    "campaigns_enabled",
    "payments_enabled",
    "dte_enabled",
  ]) {
    assert.match(migration, new RegExp(`${field} boolean not null default false`));
  }
  assert.match(migration, /tax_document_mode text not null default 'unconfigured'/);
  assert.match(migration, /'unconfigured','citaya_dte','external_bhe'/);
  assert.match(migration, /CAMPAIGNS_REQUIRE_EXTERNAL_COMMUNICATIONS/);
  assert.match(migration, /DTE_FEATURE_TAX_MODE_MISMATCH/);
  assert.match(migration, /EXTERNAL_BHE_EVIDENCE_REQUIRED/);
});

test("CIT-72 preserves current live tenants while new tenants remain fail-closed", () => {
  assert.match(
    migration,
    /where tenant\.id=features\.tenant_id[\s\S]*tenant\.operational_mode='live'/,
  );
  assert.match(migration, /after insert on public\.tenants/);
  assert.match(migration, /values \(new\.id\)[\s\S]*on conflict \(tenant_id\) do nothing/);
});

test("CIT-72 separates core legal readiness from DTE legal readiness", () => {
  assert.match(migration, /tenant_core_legal_gate_report/);
  const coreStart = migration.indexOf("create or replace function public.tenant_core_legal_gate_report");
  const taxStart = migration.indexOf("create or replace function public.tenant_tax_document_readiness");
  assert.ok(coreStart >= 0 && taxStart > coreStart);
  const core = migration.slice(coreStart, taxStart);
  assert.doesNotMatch(core, /tenant_tax_identity_complete/);
  assert.doesNotMatch(core, /tenant_dte_authority_report/);
  assert.match(core, /consumer_terms/);
  assert.match(core, /privacy_notice/);
  assert.match(core, /cancellation_refund_policy/);
});

test("CIT-72 public booking identity no longer requires DTE issuer identity", () => {
  assert.match(publicLegalServer, /tenant_core_legal_gate_report/);
  assert.match(publicLegalServer, /identityLegalComplete === true/);
  const identitySection = publicLegalServer.slice(
    publicLegalServer.indexOf("const identityComplete"),
    publicLegalServer.indexOf("return {", publicLegalServer.indexOf("const identityComplete")),
  );
  assert.doesNotMatch(identitySection, /issuer_legal_name|issuer_rut|issuer_address/);
});

test("CIT-72 live readiness conditionally requires payments and DTE", () => {
  assert.match(migration, /payment_gate_ready/);
  assert.match(migration, /not coalesce\(feature\.payments_enabled,false\) or facts\.payment_provider_ready/);
  assert.match(migration, /taxDocumentMode/);
  assert.match(migration, /taxDocumentReady/);
  assert.match(migration, /when 'external_bhe' then/);
  assert.match(migration, /when 'citaya_dte' then/);
  assert.match(migration, /and evaluated\.appointments_enabled[\s\S]*and evaluated\.payment_gate_ready[\s\S]*and evaluated\.tax_document_ready/);
});

test("CIT-72 live capabilities no longer imply payments, campaigns or DTE", () => {
  const resolverStart = migration.indexOf("create or replace function public.resolve_tenant_operational_capabilities");
  const setterStart = migration.indexOf("create or replace function public.set_tenant_operational_features");
  assert.ok(resolverStart >= 0 && setterStart > resolverStart);
  const resolver = migration.slice(resolverStart, setterStart);

  assert.match(resolver, /'createPayment',coalesce\(feature\.payments_enabled,false\) and live_gates\.payment_ready/);
  assert.match(resolver, /'sendCampaign',coalesce\(feature\.campaigns_enabled,false\)/);
  assert.match(resolver, /'enqueueDte',coalesce\(feature\.dte_enabled,false\) and live_gates\.tax_document_ready/);
  assert.doesNotMatch(resolver, /'createPayment',true/);
  assert.doesNotMatch(resolver, /'sendCampaign',true/);
  assert.doesNotMatch(resolver, /'enqueueDte',true/);
});

test("privileged server gates use the authoritative DB capability resolver", () => {
  assert.match(operationalServer, /supabaseAdmin\.rpc\("resolve_tenant_operational_capabilities"/);
  assert.doesNotMatch(operationalServer, /resolveTenantOperationalCapabilities/);
  assert.match(operationalServer, /assertTenantCanSendCampaign/);
  assert.match(operationalServer, /assertTenantCanCreatePayment/);
  assert.match(operationalServer, /assertTenantCanEnqueueDte/);
});

test("feature changes have a platform-only audited API and canonical RPC", () => {
  assert.match(platformApi, /requirePlatformAdmin/);
  assert.match(platformApi, /set_tenant_operational_features/);
  assert.match(platformApi, /Todas las capacidades deben definirse explícitamente/);
  assert.match(migration, /tenant_operational_features_audit/);
  assert.match(migration, /LIVE_TENANT_FEATURE_CHANGE_NOT_READY/);
  assert.match(migration, /public\.is_platform_admin\(p_actor_id\)/);
});
