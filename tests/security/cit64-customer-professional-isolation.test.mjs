import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PA = "11111111-1111-4111-8111-111111111111";
const PB = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";
const CUSTOMER = "44444444-4444-4444-8444-444444444444";
const FOREIGN_CUSTOMER = "55555555-5555-4555-8555-555555555555";
const privateError = { message: "private message", details: "private details", hint: "private hint" };
const state = {};
class Query {
  constructor(table) { this.table = table; this.filters = []; this.operation = "read"; }
  select() { return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  maybeSingle() { return this; }
  single() { return this; }
  update(row) { this.operation = "update"; this.row = row; return this; }
  insert(row) { this.operation = "insert"; this.row = row; return this; }
  then(accept, reject) {
    return Promise.resolve().then(() => {
      state.queries.push(this);
      const stage = `${this.table}:${this.operation}`;
      if (state.failure === stage) {
        if (state.throwError) throw new Error(privateError.message);
        return { data: null, error: privateError };
      }
      const rows = state[this.table];
      if (this.operation === "insert") {
        const row = { id: CUSTOMER, ...this.row };
        rows.push(row);
        return { data: structuredClone(row), error: null };
      }
      const row = rows.find((item) => this.filters.every(([key, value]) => item[key] === value));
      if (row && this.operation === "update") Object.assign(row, this.row);
      return { data: row ? structuredClone(row) : null, error: null };
    }).then(accept, reject);
  }
}
// Execute the real route and validators with simulated auth and database only.
globalThis.__cit64Customer = {
  supabaseServer: { auth: { async getUser() {
    state.events.push("bearer");
    return state.badToken ? { error: privateError } : { data: { user: { id: "admin" } } };
  } } },
  async requireTenantAdmin({ tenantId }) {
    state.events.push("membership");
    state.requestedTenant = tenantId;
    return state.access;
  },
  supabaseAdmin: { from(table) {
    assert.ok(["professionals", "customers"].includes(table));
    state.events.push(table);
    return new Query(table);
  } },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = { "next/server": "next", "@/lib/supabaseAdmin": "supabaseAdmin", "@/lib/supabaseServer": "supabaseServer", "@/lib/api/requireTenantAdmin": "requireTenantAdmin" };
    if (mocks[specifier]) return { url: `cit64-customer:${mocks[specifier]}`, shortCircuit: true };
    if (["@/lib/api/validators", "@/lib/dte/rut"].includes(specifier)) {
      return { url: pathToFileURL(resolve(`${specifier.slice(2)}.ts`)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "cit64-customer:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    if (url.startsWith("cit64-customer:")) {
      const name = url.split(":")[1];
      return { format: "module", source: `export const ${name} = globalThis.__cit64Customer.${name};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { POST } = await import(pathToFileURL(resolve("app/api/customers/create/route.ts")).href);
const input = () => ({ tenantId: A, professionalId: PA, fullName: "Cliente", customerRut: "12.345.678-5", phone: " +56 (9) 1234-5678 ", email: " CLIENTE@EXAMPLE.TEST ", notes: " nota   cliente " });
const customer = (tenant_id = A) => ({ id: tenant_id === A ? CUSTOMER : FOREIGN_CUSTOMER, tenant_id, rut_normalized: "12345678-5", phone: "+56912345678", email: "cliente@example.test", professional_id: tenant_id === A ? PA : PB });
test.beforeEach((t) => {
  Object.assign(state, { access: { ok: true, tenantId: A }, badToken: false, events: [], queries: [], failure: null, throwError: false, professionals: [{ id: PA, tenant_id: A }, { id: PB, tenant_id: B }], customers: [customer(B)] });
  t.mock.method(console, "error", () => {});
});
async function request(body = input(), token = "valid") {
  const req = new Request("https://tenant-a.example.test/api/customers/create", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await POST(req);
  return { status: response.status, headers: [...response.headers], body: await response.json() };
}
function setup(mode) {
  const body = input();
  if (mode !== "insert") state.customers.push(customer());
  if (mode === "direct") body.customerId = CUSTOMER;
  return body;
}
function assertScoped() {
  for (const q of state.queries) {
    if (q.operation === "insert") assert.equal(q.row.tenant_id, A);
    else assert.ok(q.filters.some(([key, value]) => key === "tenant_id" && value === A));
    if (q.operation === "update") assert.ok(q.filters.some(([key]) => key === "id"));
  }
}
for (const mode of ["insert", "direct", "existing"]) {
  for (const withProfessional of [true, false]) {
    test(`${mode}: own professional or omitted (${withProfessional}) preserves customer flow`, async () => {
      const body = setup(mode);
      if (!withProfessional) delete body.professionalId;
      const beforeB = structuredClone(state.customers[0]);
      const result = await request(body);
      assert.equal(result.status, 200);
      assert.equal(result.body.reused, mode !== "insert");
      assert.deepEqual(state.events.slice(0, 3), ["bearer", "json", "membership"]);
      assertScoped();
      const writes = state.queries.filter((q) => q.operation !== "read");
      assert.equal(writes.length, 1);
      if (withProfessional) {
        assert.equal(writes[0].row.professional_id, PA);
        assert.equal(state.queries[0].table, "professionals");
        assert.deepEqual(state.queries[0].filters, [["id", PA], ["tenant_id", A]]);
      } else {
        assert.equal(Object.hasOwn(writes[0].row, "professional_id"), false);
        assert.ok(state.queries.every((q) => q.table === "customers"));
      }
      const saved = state.customers.find((row) => row.tenant_id === A);
      assert.equal(saved.rut_normalized, "12345678-5");
      assert.equal(saved.phone, "+56912345678");
      assert.equal(saved.email, "cliente@example.test");
      assert.equal(saved.notes, "nota cliente");
      assert.deepEqual(state.customers[0], beforeB);
    });
  }
  test(`${mode}: foreign and missing professionals share response before customer writes`, async () => {
    const body = setup(mode);
    const before = structuredClone(state.customers);
    const foreign = await request({ ...body, professionalId: PB });
    const missing = await request({ ...body, professionalId: MISSING });
    assert.equal(foreign.status, 400);
    assert.deepEqual(foreign.body, { ok: false, error: "professionalId inválido" });
    assert.deepEqual(foreign, missing);
    assert.ok(state.queries.every((q) => q.table === "professionals" && q.operation === "read"));
    assertScoped();
    assert.deepEqual(state.customers, before);
  });
}
for (const match of ["phone", "email"]) {
  test(`dedup by ${match} remains tenant scoped`, async () => {
    const row = customer();
    row.rut_normalized = null;
    if (match === "email") row.phone = null;
    state.customers.push(row);
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.body.reused, true);
    assertScoped();
    assert.ok(state.queries.some((q) => q.filters.some(([key]) => key === match)));
  });
}
test("canonical tenant comes from access after membership", async () => {
  // Deliberately distinct mocked boundary result detects reuse of the body hint.
  assert.equal((await request({ ...input(), tenantId: B })).status, 200);
  assert.equal(state.requestedTenant, B);
  assertScoped();
});
for (const mode of ["missing bearer", "invalid bearer", "membership denied"]) {
  test(`${mode} preserves authentication order and prevents data access`, async () => {
    if (mode === "invalid bearer") state.badToken = true;
    if (mode === "membership denied") state.access = { ok: false, status: 403, error: "Forbidden" };
    const result = await request(input(), mode === "missing bearer" ? "" : "valid");
    assert.equal(result.status, mode === "membership denied" ? 403 : 401);
    assert.equal(state.queries.length, 0);
    assert.deepEqual(state.events, mode === "missing bearer" ? [] : mode === "invalid bearer" ? ["bearer"] : ["bearer", "json", "membership"]);
  });
}
for (const stage of ["professionals:read", "customers:read", "customers:update", "customers:insert"]) {
  for (const throwError of [false, true]) {
    test(`${stage} failure (${throwError}) exposes no internals`, async () => {
      state.failure = stage;
      state.throwError = throwError;
      const result = await request(setup(stage === "customers:update" ? "direct" : "insert"));
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { ok: false, error: "Error inesperado" });
      assert.doesNotMatch(JSON.stringify(result), /private|details|hint/);
      if (stage === "professionals:read") assert.ok(state.queries.every((q) => q.table === "professionals"));
    });
  }
}
test("foreign customer cannot be changed through direct update", async () => {
  const before = structuredClone(state.customers);
  await request({ ...input(), customerId: FOREIGN_CUSTOMER });
  assertScoped();
  assert.deepEqual(state.customers, before);
});
test("dedup retains conflicting RUT rejection", async () => {
  state.customers.push({ ...customer(), rut_normalized: "11111111-1" });
  assert.equal((await request()).status, 409);
  assert.ok(state.queries.every((q) => q.operation === "read"));
});
