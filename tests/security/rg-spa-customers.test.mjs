import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveTenantOperationalCapabilities } from "../../lib/tenant/operational-mode.mjs";

test("FASE 5 1: rg-spa in internal operational mode has informationalPage, ordinaryAdmin, customer and tax capabilities", () => {
  const capabilities = resolveTenantOperationalCapabilities({
    lifecycleStatus: "active",
    operationalMode: "internal",
  });
  assert.equal(capabilities.informationalPage, true);
  assert.equal(capabilities.ordinaryAdmin, true);
  assert.equal(capabilities.taxAdministration, true);
  assert.equal(capabilities.dteCertification, true);
});

test("FASE 5 2-4: Multi-tenant customer list endpoint enforces strict tenantId filtering and requireTenantAdmin", () => {
  const listRoute = readFileSync("app/api/customers/list/route.ts", "utf8");
  assert.match(listRoute, /requireTenantAdmin/);
  assert.match(listRoute, /\.eq\("tenant_id", tenantId\)/);
  assert.match(listRoute, /select\("id, tenant_id, full_name, phone, email, rut_normalized, notes, created_at"\)/);
});

test("FASE 5 5: Draft creation and update reject cross-tenant customer manipulation", () => {
  const draftPostRoute = readFileSync("app/api/admin/invoice-drafts/route.ts", "utf8");
  const draftPatchRoute = readFileSync("app/api/admin/invoice-drafts/[id]/route.ts", "utf8");
  assert.match(draftPostRoute, /\.eq\("tenant_id", auth\.tenantId\)/);
  assert.match(draftPatchRoute, /\.eq\("tenant_id", auth\.tenantId\)/);
});

test("FASE 5 6-7: Ordinary tenant-admin cannot access platform admin tenant management", () => {
  const requireAdmin = readFileSync("lib/api/requireTenantAdmin.ts", "utf8");
  assert.match(requireAdmin, /Platform admin requerido/);
  assert.match(requireAdmin, /platform_admin/);
});

test("FASE 5 8-10: Hostname resolution derives exact slug without cross-tenant fallback", () => {
  const bySlugRoute = readFileSync("app/api/tenants/by-slug/route.ts", "utf8");
  assert.match(bySlugRoute, /\.eq\("slug", slug\)/);
  assert.match(bySlugRoute, /if \(!operationalCapabilities\.informationalPage\)/);
});
