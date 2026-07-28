import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("cutover migration applies tenant RLS and keeps privileged mutations service-only", () => {
  const sql = read("migrations/202607270001_dte_legal_activation.sql");
  for (const table of [
    "customer_tax_profiles",
    "dte_sii_authorization_evidence",
    "dte_legal_activation",
    "dte_legal_activation_events",
  ]) assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(sql, /public\.is_tenant_member\(tenant_id\) or public\.is_platform_admin\(\)/);
  assert.match(sql, /revoke all on function public\.dte_activate_legal_issuance[\s\S]*from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.dte_activate_legal_issuance[\s\S]*to service_role/);
});

test("RLS matrix covers own tenant, foreign tenant, no membership, admins and public", () => {
  const matrix = read("tests/security/rls_matrix.sql");
  for (const concept of ["tenant", "platform", "anon", "authenticated"]) {
    assert.match(matrix.toLowerCase(), new RegExp(concept));
  }
  const migration = read("migrations/202607270001_dte_legal_activation.sql");
  assert.match(migration, /revoke all on public\.dte_sii_authorization_evidence from public, anon, authenticated/);
  assert.match(migration, /customer_tax_profiles_tenant_admin/);
});

test("admin routes derive tenant from host and use generic foreign-resource responses", () => {
  for (const path of [
    "app/api/admin/dte-intents/manual/route.ts",
    "app/api/admin/dte-intents/reference-data/route.ts",
    "app/api/admin/dte-intents/[id]/email/route.ts",
    "app/api/admin/dte-intents/[id]/note/route.ts",
    "app/api/admin/dte-authorization/route.ts",
    "app/api/admin/dte-activation/route.ts",
    "app/api/admin/customers/[id]/tax-profile/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /requireHostTenantAdmin/);
    assert.doesNotMatch(source, /body\?\.tenantId/);
  }
});

test("manual issuance rejects foreign IDs and never trusts browser amounts", () => {
  const route = read("app/api/admin/dte-intents/manual/route.ts");
  assert.match(route, /\.eq\("tenant_id", auth\.tenantId\)/);
  assert.match(route, /\.eq\("customer_id", customerId\)/);
  assert.match(route, /verifiedPayment\.appointment_id !== appointmentId/);
  assert.match(route, /payment_intents[\s\S]*\.eq\("status", "succeeded"\)/);
  assert.doesNotMatch(route, /body\?\.(amount|total|tax|tenantId)/);
});

test("private artifact download and email gates are authenticated and deliverable-only", () => {
  const download = read("app/api/admin/dte-production/[id]/artifacts/[kind]/route.ts");
  const email = read("app/api/admin/dte-intents/[id]/email/route.ts");
  assert.match(download, /requireProductionAdmin/);
  assert.match(download, /cache-control": "private, no-store/);
  assert.match(email, /requireHostTenantAdmin/);
  assert.match(email, /canEmailDte/);
  assert.match(email, /\.eq\("tenant_id", auth\.tenantId\)/);
});

test("worker is tenant-aware, type-aware, exactly once and has no R&G fallback", () => {
  const worker = read("lib/dte/automation/worker.ts");
  const migration = read("migrations/202607240002_dte_automatic_issuance.sql");
  assert.match(worker, /dte_activation_gate_report/);
  assert.match(worker, /dte_legal_activation/);
  assert.match(worker, /immutable_snapshot/);
  assert.match(worker, /\[33, 56, 61\]\.includes/);
  assert.match(worker, /original_production_document_id/);
  assert.match(worker, /\.eq\("tenant_id", item\.tenant_id\)/);
  assert.doesNotMatch(worker, /rg-spa|781956457|R&G/i);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /network_attempts between 0 and 1/);
});

test("authorization evidence is platform-admin only and keeps tenant admin read-only", () => {
  const route = read("app/api/admin/dte-authorization/route.ts");
  assert.match(route, /auth\.authMode !== "platform_admin"/);
  assert.match(route, /status: 404/);
  assert.match(route, /p_actor_id: auth\.userId/);
  assert.match(route, /p_authorized_types: authorizedTypes/);
});

test("activation and pause are platform-admin, gated, transactional RPC actions", () => {
  const route = read("app/api/admin/dte-activation/route.ts");
  const migration = read("migrations\/202607270001_dte_legal_activation.sql");
  assert.match(route, /auth\.authMode !== "platform_admin"/);
  assert.match(route, /dte_activate_legal_issuance/);
  assert.match(route, /dte_pause_legal_issuance/);
  assert.match(migration, /DTE_ACTIVATION_GATES_INCOMPLETE/);
  assert.match(migration, /LEGAL_ISSUANCE_PAUSED/);
  assert.doesNotMatch(route, /supabaseAdmin\.from\("dte_legal_activation"\)\.upsert/);
});

test("notes require an accepted tenant-owned primary document and preserve its reference", () => {
  const route = read("app/api/admin/dte-intents/[id]/note/route.ts");
  assert.match(route, /\.eq\("tenant_id", auth\.tenantId\)/);
  assert.match(route, /\.eq\("status", "ACCEPTED"\)/);
  assert.match(route, /original_production_document_id: original\.production_document_id/);
  assert.match(route, /referenceCode !== "3"/);
  assert.match(route, /adjustmentAmount > Number\(original\.amount_snapshot\)/);
  assert.match(route, /\[56, 61\]\.includes\(dteType\)/);
  assert.match(route, /dte_activation_gate_report/);
  assert.match(route, /gate\?\.ready === true/);
});

test("historical payment and manual issuance require a valid customer RUT", () => {
  const payment = read("app/api/payments/create/route.ts");
  const manual = read("app/api/admin/dte-intents/manual/route.ts");
  assert.match(payment, /validateRut\(customerRut\)/);
  assert.match(payment, /Completa el RUT válido del cliente antes de pagar/);
  assert.match(manual, /normalizeRequiredCustomerRut\(customer\.rut_normalized\)/);
  assert.match(manual, /Confirma el pago manual o en efectivo/);
});

test("production remains disabled and tests contain no real network operation", () => {
  const env = read(".env.example");
  const policy = read("lib/dte/automation/issuance-policy.mjs");
  assert.match(env, /DTE_PRODUCTION_ENABLED=false/);
  assert.match(policy, /GLOBAL_PRODUCTION_DISABLED/);
  assert.doesNotMatch(read("tests/security/dte-legal-cutover.test.mjs"), /fetch\(|https:\/\/|sii\.cl\/cgi/);
});
