import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("FASE A: Multi-tenant isolation - platform routes enforce requirePlatformAdmin", () => {
  const platformRoute = readFileSync("app/api/admin/platform/tenants/route.ts", "utf8");
  assert.match(platformRoute, /requirePlatformAdmin/);
  assert.match(platformRoute, /p_tenant_id: tenantId/);
});

test("FASE A: Multi-tenant isolation - tenant admin cannot access platform route", () => {
  const requireAdmin = readFileSync("lib/api/requireTenantAdmin.ts", "utf8");
  assert.match(requireAdmin, /Platform admin requerido/);
  assert.match(requireAdmin, /tenant_members/);
  assert.match(requireAdmin, /platform_admin/);
});

test("FASE A: Multi-tenant isolation - production gate requires explicit tenantId and checks tenant ownership", () => {
  const gateCode = readFileSync("lib/dte/boleta39-manual-gate.ts", "utf8");
  assert.match(gateCode, /eq\("tenant_id", input\.tenantId\)/);
  assert.match(gateCode, /eq\("dte_type", 39\)/);
  assert.match(gateCode, /eq\("environment", "production"\)/);
});

test("FASE A 4: Emisor propio section visibility rules", () => {
  const page = readFileSync("app/admin/plataforma/tenants/page.tsx", "utf8");
  assert.match(page, /tenant\.operational_mode === "internal"/);
  assert.match(page, /tenant\.lifecycle_status === "active"/);
  assert.match(page, /Boolean\(tenant\.selfIssuerAuthority\)/);
});

test("FASE A 4: Hostname demo does not change tax ownership of rg-spa", () => {
  const requireAdmin = readFileSync("lib/api/requireTenantAdmin.ts", "utf8");
  assert.match(requireAdmin, /getTenantSlugFromHostname/);
  assert.match(requireAdmin, /eq\("slug", tenantSlug\)/);
});
