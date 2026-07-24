import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("new DTE migration is additive, tenant scoped and exactly once", () => {
  const sql = read("migrations/202607240002_dte_automatic_issuance.sql");
  assert.match(sql, /create table if not exists public\.dte_tenant_issuance_settings/);
  assert.match(sql, /create table if not exists public\.dte_payment_document_intents/);
  assert.match(sql, /create table if not exists public\.dte_issuance_outbox/);
  assert.match(sql, /create table if not exists public\.dte_document_events/);
  assert.match(sql, /unique \(tenant_id, idempotency_key\)/);
  assert.match(sql, /unique \(tenant_id, payment_key, appointment_id, requested_document\)/);
  assert.match(sql, /network_attempt_count between 0 and 1/);
  assert.match(sql, /dte_document_events are append-only/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /public\.is_tenant_member\(tenant_id\) or public\.is_platform_admin\(\)/);
  assert.match(sql, /production_enabled boolean not null default false/);
  assert.match(sql, /Logical rollback:/);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i);
});

test("payment finalize writes outbox in the same transaction", () => {
  const sql = read("migrations/202607240002_dte_automatic_issuance.sql");
  const finalize = sql.match(/create or replace function public\.finalize_verified_payment[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.match(finalize, /dte_enqueue_payment_snapshot/);
  assert.match(finalize, /payment_intents/);
  assert.match(finalize, /appointments/);
});

test("previous security migration contains valid delimiters and bounded normalization", () => {
  const sql = read("migrations/202607230001_security_hardening.sql");
  const activation = sql.match(/create or replace function public\.activate_payment_intent[\s\S]*?revoke all on function public\.activate_payment_intent/)?.[0] ?? "";
  assert.match(activation, /as \$\$[\s\S]*?end;\n\$\$;/);
  assert.match(sql, /where lower\(coalesce\(status, ''\)\) in \('canceled', 'cancelled'\)[\s\S]*booking_status = 'confirmed'/);
});

test("billing executive UI is simple and technical mode is role gated", () => {
  const page = read("app/admin/facturacion/page.tsx");
  const api = read("app/api/admin/dte-settings/route.ts");
  for (const label of ["Estado de activación", "Emisión automática", "Datos tributarios", "Documentos recientes", "Emitir manualmente", "Modo técnico avanzado"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /state\.technicalAccess/);
  assert.match(page, /advancedOpen \? <div/);
  assert.match(api, /requireHostTenantAdmin/);
  assert.doesNotMatch(page, /R&G|Centro Psicológico|Proveedor externo \/ API|vista futura/i);
});

test("production routes derive tenant from hostname and never trust body tenant id", () => {
  const auth = read("lib/dte/production/api.ts");
  const hostAuth = read("lib/api/requireTenantAdmin.ts");
  assert.match(auth, /requireHostTenantAdmin\(req\)/);
  assert.match(hostAuth, /getTenantSlugFromHostname\(host\)/);
  assert.match(hostAuth, /\.eq\("slug", tenantSlug\)/);
});

test("consumer boleta remains explicitly unsupported in production", () => {
  const types = read("lib/dte/production/types.ts");
  const policy = read("lib/dte/automation/issuance-policy.mjs");
  assert.match(types, /PRODUCTION_DTE_TYPES = \[33, 56, 61\]/);
  assert.match(policy, /DOCUMENT_TYPE_UNSUPPORTED/);
  assert.doesNotMatch(policy, /IMPLEMENTED_PRODUCTION_TYPES = Object\.freeze\(\[[^\]]*(39|41)/);
});
