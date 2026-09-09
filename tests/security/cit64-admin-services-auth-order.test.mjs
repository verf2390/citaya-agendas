import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const state = {};
const secret = { message: "private message", details: "private details", hint: "private hint" };
class Query {
  constructor() { this.op = "select"; this.filters = []; }
  select(columns) { this.columns = columns; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  order() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  insert(row) { this.op = "insert"; this.row = row; return this; }
  update(row) { this.op = "update"; this.row = row; return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => {
      state.queries.push(this);
      const stage = this.op === "select" ? (state.updated ? "readback" : "read") : this.op;
      if (state.throwAt === stage) throw new Error(secret.message);
      if (state.errorAt === stage || state.noCreated && this.columns?.includes("created_at")) return { data: null, error: secret };
      const matches = (row) => this.filters.every(([key, value]) => row[key] === value);
      let data = state.services.filter(matches);
      if (this.op === "insert") {
        data = [{ id: "new-service", ...this.row }];
        state.services.push(...data);
      }
      if (this.op === "update") {
        data.forEach((row) => Object.assign(row, this.row));
        state.updated = true;
      }
      return { data: this.one ? data[0] ?? null : data, error: null };
    }).then(resolve, reject);
  }
}
// Real route with mocked hostname boundary and DB. The helper's internal
// tenant lookup before bearer validation is unchanged, outside this test.
globalThis.__cit64AdminServices = {
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
      assert.equal(table, "services", "No manual tenant lookup");
      return new Query();
    },
  },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = { "next/server": "next", "@/lib/supabaseAdmin": "db", "@/lib/api/requireTenantAdmin": "auth" };
    if (map[specifier]) return { url: `cit64-services:${map[specifier]}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: pathToFileURL(resolve(specifier.slice(2) + ".ts")).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const map = {
      "cit64-services:next": "export const NextResponse = Response;",
      "cit64-services:db": "export const supabaseAdmin = globalThis.__cit64AdminServices.supabaseAdmin;",
      "cit64-services:auth": "export const requireHostTenantAdmin = globalThis.__cit64AdminServices.requireHostTenantAdmin;",
    };
    if (map[url]) return { format: "module", source: map[url], shortCircuit: true };
    return nextLoad(url, context);
  },
});
const handlers = await import(pathToFileURL(resolve("app/api/admin/services/route.ts")).href);
const payload = () => ({ id: SA, tenantId: B, tenant: "tenant-b", name: " Updated ", price: 1000, duration_min: 30, is_active: false });
test.beforeEach((t) => {
  t.mock.method(console, "error", () => {});
  Object.assign(state, {
    access: { ok: true, tenantId: A }, events: [], queries: [], errorAt: null, throwAt: null, updated: false, noCreated: false,
    services: [{ id: SA, tenant_id: A, name: "A", is_active: false }, { id: SB, tenant_id: B, name: "B", is_active: true }],
  });
});
async function request(method, body = payload()) {
  const req = new Request(`https://tenant-a.citaya.test/api/admin/services?tenant=tenant-b&tenantId=${B}`, {
    method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await handlers[method](req);
  return { response, body: await response.json() };
}
for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  for (const status of [401, 403, 400, 500]) {
    test(`${method} auth failure ${status} prevents parsing and DB access`, async () => {
      state.access = { ok: false, status, error: secret.message };
      const result = await request(method, null);
      assert.equal(result.response.status, status);
      assert.deepEqual(result.body, { ok: false, error: status === 401 ? "Unauthorized" : "Forbidden" });
      assert.deepEqual(state.events, ["auth:start", "auth:end"]);
      assert.equal(state.queries.length, 0);
    });
  }
}
for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  test(`${method} ignores query/body tenant B and binds all operations to A`, async () => {
    const beforeB = structuredClone(state.services[1]);
    const result = await request(method);
    assert.equal(result.response.status, 200);
    assert.deepEqual(state.events.slice(0, method === "GET" ? 2 : 3), ["auth:start", "auth:end", ...(method === "GET" ? [] : ["json"])]);
    for (const q of state.queries) {
      if (q.op === "insert") assert.equal(q.row.tenant_id, A);
      else {
        assert.ok(q.filters.some(([key, value]) => key === "tenant_id" && value === A));
        if (method !== "GET") assert.ok(q.filters.some(([key, value]) => key === "id" && value === SA));
      }
    }
    assert.deepEqual(state.services[1], beforeB);
    if (method === "GET") assert.deepEqual(result.body.services.map((row) => row.id), [SA]);
    if (method === "POST" || method === "PATCH") assert.equal(result.body.service.name, "Updated");
    if (method === "DELETE") assert.equal(state.services[0].is_active, false);
  });
}
for (const method of ["PATCH", "DELETE"]) {
  test(`${method} foreign service returns 404 without mutation`, async () => {
    const before = structuredClone(state.services);
    const result = await request(method, { ...payload(), id: SB });
    assert.equal(result.response.status, 404);
    assert.deepEqual(state.services, before);
    assert.ok(state.queries.every((q) => q.op === "select"));
  });
}
for (const method of ["GET", "PATCH"]) {
  test(`${method} created_at fallback retains tenant and id filters`, async () => {
    state.noCreated = true;
    const result = await request(method);
    assert.equal(result.response.status, 200);
    assert.ok(state.queries.some((q) => q.columns?.includes("created_at")));
    assert.ok(state.queries.some((q) => q.columns && !q.columns.includes("created_at")));
    for (const q of state.queries) {
      assert.ok(q.filters.some(([key, value]) => key === "tenant_id" && value === A));
      if (method === "PATCH") assert.ok(q.filters.some(([key, value]) => key === "id" && value === SA));
    }
  });
}
for (const [method, stage] of [["GET", "read"], ["POST", "insert"], ["PATCH", "read"], ["PATCH", "update"], ["PATCH", "readback"], ["DELETE", "read"], ["DELETE", "update"]]) {
  test(`${method} ${stage} DB errors are generic`, async () => {
    state.errorAt = stage;
    const result = await request(method);
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.body, { ok: false, error: "Error interno" });
  });
}
for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  test(`${method} unexpected exceptions are generic`, async () => {
    state.throwAt = method === "POST" ? "insert" : "read";
    const result = await request(method);
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.body, { ok: false, error: "Error interno" });
  });
}
