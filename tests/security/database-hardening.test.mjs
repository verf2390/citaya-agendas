import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../migrations/202607230001_security_hardening.sql", import.meta.url), "utf8");
const createRoute = readFileSync(new URL("../../app/api/appointments/create/route.ts", import.meta.url), "utf8");

test("booking concurrency is guaranteed by PostgreSQL and public creation RPC", () => {
  assert.match(migration, /appointments_no_professional_overlap/);
  assert.match(migration, /exclude using gist/);
  assert.match(migration, /when exclusion_violation/);
  assert.match(migration, /create or replace function public\.create_public_appointment/);
});

test("duration, price, service and professional are server-controlled", () => {
  assert.match(createRoute, /select\("id, tenant_id, duration_min, price, currency, is_active, tax_treatment"\)/);
  assert.match(createRoute, /p_start_at:/);
  assert.doesNotMatch(createRoute, /p_end_at:/);
  assert.match(migration, /v_end_at := p_start_at \+ make_interval\(mins => v_service\.duration_min\)/);
  assert.match(migration, /p\.tenant_id = p_tenant_id[\s\S]*p\.active is true/);
});

test("idempotency, rate limits and tenant RLS are canonical", () => {
  assert.match(migration, /unique \(tenant_id, idempotency_key\)/);
  assert.match(migration, /consume_api_rate_limit/);
  assert.match(migration, /create policy tenant_member_access/);
  assert.match(migration, /public\.is_tenant_member\(tenant_id\) or public\.is_platform_admin\(\)/);
  assert.match(migration, /revoke all on public\.appointments, public\.customers, public\.payments/);
});

test("UUID-only IDOR is blocked and public response excludes sensitive fields", () => {
  const byId = readFileSync(new URL("../../app/api/appointments/by-id/route.ts", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../../lib/api/requireTenantAdmin.ts", import.meta.url), "utf8");
  assert.match(byId, /authorizeAppointmentActor/);
  assert.match(byId, /if \(!access\.ok\) return notFound\(\)/);
  assert.match(auth, /\.eq\("tenant_id", input\.tenantId\)/);
  assert.match(auth, /TENANT_ADMIN_ROLES/);
  const responseSection = byId.slice(byId.indexOf("const common ="));
  assert.doesNotMatch(responseSection, /manage_token|payment_reference|payment_url|audit_metadata/);
});

test("[structural] appointment by-id disambiguates the direct tenant relationship", () => {
  const byId = readFileSync(new URL("../../app/api/appointments/by-id/route.ts", import.meta.url), "utf8");
  assert.match(byId, /tenant:tenants!appointments_tenant_id_fkey\(/);
  assert.doesNotMatch(byId, /tenant:tenants\(/);
});
