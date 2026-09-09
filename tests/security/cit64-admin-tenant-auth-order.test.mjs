import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SELECT = "id, slug, name, phone_display, whatsapp, contact_email, address, city, description, logo_url";
const state = {};
const secret = { message: "private message", details: "private details", hint: "private hint" };
class Query {
  constructor() { this.filters = []; }
  select(columns) { this.columns = columns; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  maybeSingle() { return this; }
  single() { return this; }
  update(row) { this.row = row; return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => {
      state.queries.push(this);
      if (state.throws) throw new Error(secret.message);
      if (state.error) return { data: null, error: secret };
      const row = state.tenants.find((row) => this.filters.every(([key, value]) => row[key] === value));
      if (row && this.row) Object.assign(row, this.row);
      const data = row ? Object.fromEntries(this.columns.split(", ").map((key) => [key, row[key] ?? null])) : null;
      return { data, error: null };
    }).then(resolve, reject);
  }
}
// Real handlers, simulated boundary and DB; the helper's internal lookup
// before bearer validation remains unchanged and outside this route test.
globalThis.__cit64AdminTenant = {
  async requireHostTenantAdmin(req) {
    state.events.push("auth:start");
    await Promise.resolve();
    assert.equal(new URL(req.url).hostname, "tenant-a.citaya.test");
    state.events.push("auth:end");
    return state.access;
  },
  supabaseAdmin: {
    from(table) {
      state.events.push(table);
      assert.equal(table, "tenants");
      return new Query();
    },
  },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = { "next/server": "next", "@/lib/supabaseAdmin": "db", "@/lib/api/requireTenantAdmin": "auth" };
    if (map[specifier]) return { url: `cit64-tenant:${map[specifier]}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const map = {
      "cit64-tenant:next": "export const NextResponse = Response;",
      "cit64-tenant:db": "export const supabaseAdmin = globalThis.__cit64AdminTenant.supabaseAdmin;",
      "cit64-tenant:auth": "export const requireHostTenantAdmin = globalThis.__cit64AdminTenant.requireHostTenantAdmin;",
    };
    if (map[url]) return { format: "module", source: map[url], shortCircuit: true };
    return nextLoad(url, context);
  },
});
const handlers = await import(pathToFileURL(resolve("app/api/admin/tenant/route.ts")).href);
const payload = () => ({ tenantSlug: "tenant-b", name: " Updated ", phone_display: " 123 ", whatsapp: "+56 12345678", contact_email: " a@example.test ", address: " ", city: " City ", description: null, logo_url: " logo " });
test.beforeEach((t) => {
  t.mock.method(console, "error", () => {});
  Object.assign(state, {
    access: { ok: true, tenantId: A }, events: [], queries: [], error: false, throws: false,
    tenants: [{ id: A, slug: "tenant-a", name: "A", private_field: "secret" }, { id: B, slug: "tenant-b", name: "B" }],
  });
});
async function request(method, body = payload()) {
  const req = new Request("https://tenant-a.citaya.test/api/admin/tenant?tenantSlug=tenant-b", {
    method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await handlers[method](req);
  return { response, body: await response.json() };
}
for (const method of ["GET", "PATCH"]) {
  for (const status of [401, 403, 400, 500]) {
    test(`${method} boundary failure ${status} prevents JSON and every tenants query`, async () => {
      state.access = { ok: false, status, error: secret.message };
      const result = await request(method, null);
      assert.equal(result.response.status, status);
      assert.deepEqual(result.body, { ok: false, error: status === 401 ? "Unauthorized" : "Forbidden" });
      assert.deepEqual(state.events, ["auth:start", "auth:end"]);
      assert.equal(state.queries.length, 0);
    });
  }
  test(`${method} ignores slug B and reads/updates only authenticated tenant A`, async () => {
    const beforeB = structuredClone(state.tenants[1]);
    const result = await request(method);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.tenant.id, A);
    assert.equal(result.body.tenant.slug, "tenant-a");
    assert.deepEqual(state.events, ["auth:start", "auth:end", ...(method === "PATCH" ? ["json"] : []), "tenants"]);
    assert.equal(state.queries.length, 1);
    assert.deepEqual(state.queries[0].filters, [["id", A]]);
    assert.equal(state.queries[0].columns, SELECT);
    assert.deepEqual(Object.keys(result.body.tenant).sort(), SELECT.split(", ").sort());
    assert.deepEqual(state.tenants[1], beforeB);
    if (method === "PATCH") {
      assert.deepEqual(state.queries[0].row, { name: "Updated", phone_display: "123", whatsapp: "+56 12345678", contact_email: "a@example.test", address: null, city: "City", description: null, logo_url: "logo" });
    }
  });
  for (const kind of ["error", "throws"]) {
    test(`${method} DB ${kind} returns generic 500`, async () => {
      state[kind] = true;
      const result = await request(method);
      assert.equal(result.response.status, 500);
      assert.deepEqual(result.body, { ok: false, error: "Error interno" });
    });
  }
}
test("missing authenticated tenant config returns generic 404", async () => {
  state.tenants = state.tenants.filter((row) => row.id !== A);
  const result = await request("GET");
  assert.equal(result.response.status, 404);
  assert.deepEqual(result.body, { ok: false, error: "No se pudo cargar el negocio actual." });
  assert.deepEqual(state.queries[0].filters, [["id", A]]);
});
for (const [field, value] of [["name", " "], ["whatsapp", "1234567"], ["contact_email", "invalid"]]) {
  test(`PATCH preserves ${field} validation after authentication`, async () => {
    const result = await request("PATCH", { ...payload(), [field]: value });
    assert.equal(result.response.status, 400);
    assert.deepEqual(state.events, ["auth:start", "auth:end", "json"]);
    assert.equal(state.queries.length, 0);
  });
}
