#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import Module from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = resolve(repoRoot, request.slice(2));
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(output.outputText, filename);
};

const state = { user: { id: "user-a" }, tenant: { id: "11111111-1111-4111-8111-111111111111", slug: "tenant-a", lifecycle_status: "active", operational_mode: "live" }, member: null, platform: null, errors: {} };
const query = (table) => {
  const filters = {};
  const builder = {
    select() { return builder; },
    eq(key, value) { filters[key] = value; return builder; },
    async maybeSingle() {
      if (state.errors[table]) return { data: null, error: { code: state.errors[table] } };
      if (table === "tenants") {
        const matches = state.tenant && (!filters.id || state.tenant.id === filters.id) && (!filters.slug || state.tenant.slug === filters.slug);
        return { data: matches ? state.tenant : null, error: null };
      }
      if (table === "tenant_members") return { data: state.member, error: null };
      if (table === "platform_admins") return { data: state.platform, error: null };
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return builder;
};
const mock = { auth: { async getUser(token) { return token === "valid" ? { data: { user: state.user }, error: null } : { data: { user: null }, error: {} }; } }, from: query };
const supabasePath = require.resolve(resolve(repoRoot, "lib/supabaseAdmin.ts"));
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { supabaseAdmin: mock }, children: [], paths: [] };
const { requireTenantAdmin, requireHostTenantAdmin } = require(resolve(repoRoot, "lib/api/requireTenantAdmin.ts"));
const tenantId = state.tenant.id;
const req = (token = "valid", slug = "tenant-a") => new Request("https://admin.example/api", { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), host: "admin.example", ...(slug ? { "x-forwarded-host": `${slug}.citaya.online` } : {}) } });
const reset = () => { state.user = { id: "user-a" }; state.tenant = { id: tenantId, slug: "tenant-a", lifecycle_status: "active", operational_mode: "live" }; state.member = null; state.platform = null; state.errors = {}; };

test.beforeEach(reset);
test("hostname deriva tenant correcto", async () => { state.member = { role: "owner", is_active: true }; const result = await requireHostTenantAdmin(req()); assert.equal(result.ok, true); assert.equal(result.tenantId, tenantId); });
test("hostname de tenant ajeno falla cerrado", async () => { state.member = { role: "owner", is_active: true }; assert.equal((await requireHostTenantAdmin(req("valid", "tenant-b"))).status, 403); });
test("hostname correcto sin membresía queda bloqueado", async () => assert.equal((await requireHostTenantAdmin(req())).status, 403));
test("sin token devuelve 401", async () => assert.equal((await requireTenantAdmin({ req: req(""), tenantId })).status, 401));
test("JWT válido sin autorización devuelve 403", async () => assert.equal((await requireTenantAdmin({ req: req(), tenantId })).status, 403));
test("tenant ajeno devuelve 403", async () => { state.member = { role: "owner", is_active: true }; assert.equal((await requireTenantAdmin({ req: req("valid", "tenant-b"), tenantId })).status, 403); });
test("platform super_admin activo autoriza", async () => { state.platform = { role: "super_admin", is_active: true }; assert.equal((await requireTenantAdmin({ req: req(), tenantId })).authMode, "platform_admin"); });
test("platform admin inactivo rechaza", async () => { state.platform = { role: "super_admin", is_active: false }; assert.equal((await requireTenantAdmin({ req: req(), tenantId })).status, 403); });
for (const role of ["owner", "admin"]) test(`tenant member ${role} activo autoriza`, async () => { state.member = { role, is_active: true }; assert.equal((await requireTenantAdmin({ req: req(), tenantId })).authMode, "tenant_members"); });
test("member e inactivo rechazan", async () => { state.member = { role: "member", is_active: true }; assert.equal((await requireTenantAdmin({ req: req(), tenantId })).status, 403); state.member = { role: "owner", is_active: false }; assert.equal((await requireTenantAdmin({ req: req(), tenantId })).status, 403); });
test("UUID ajeno queda filtrado por tenant antes de mutar", () => {
  for (const file of ["app/api/appointments/cancel-by-id/route.ts", "app/api/appointments/reschedule-by-id/route.ts", "app/api/admin/appointments/mark-paid/route.ts", "app/api/admin/payments/mercadopago/confirm/route.ts"]) {
    const source = readFileSync(resolve(repoRoot, file), "utf8");
    assert.match(source, /require(?:Host)?TenantAdmin/);
    assert.match(source, /(?:\.eq\("tenant_id",|p_tenant_id: access\.tenantId)/);
  }
});

test("error de tabla o columna falla cerrado sin fallback", async () => { state.errors.tenant_members = "42703"; const result = await requireTenantAdmin({ req: req(), tenantId }); assert.equal(result.ok, false); assert.equal(result.status, 500); assert.equal(result.authMode, undefined); });
