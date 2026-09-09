import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PA = "11111111-1111-4111-8111-111111111111";
const PB = "22222222-2222-4222-8222-222222222222";
const SA = "33333333-3333-4333-8333-333333333333";
const SB = "44444444-4444-4444-8444-444444444444";
const MISSING = "55555555-5555-4555-8555-555555555555";
const privateError = { message: "private DB message", details: "private details", hint: "private hint" };
const state = {};
class Query {
  constructor(table) { this.table = table; this.filters = []; this.operation = "read"; }
  select(columns) { this.columns = columns; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  maybeSingle() { return this; }
  delete() { this.operation = "delete"; return this; }
  insert(rows) { this.operation = "insert"; this.rows = rows; return this; }
  then(accept, reject) {
    return Promise.resolve().then(() => {
      state.queries.push(this);
      const stage = this.operation === "read" ? this.table : this.operation;
      if (state.failure === stage) {
        if (state.throwError) throw new Error(privateError.message);
        return { data: null, error: privateError };
      }
      const rows = state[this.table];
      const matches = (row) => this.filters.every(([key, value]) => row[key] === value);
      if (this.operation === "delete") state[this.table] = rows.filter((row) => !matches(row));
      if (this.operation === "insert") rows.push(...structuredClone(this.rows));
      const row = this.operation === "read" ? rows.find(matches) : null;
      return { data: row ? structuredClone(row) : null, error: null };
    }).then(accept, reject);
  }
}
// Real handler/UUID validator, simulated hostname auth and DB.
// No remote DB; helper's internal hostname lookup is outside this route test.
globalThis.__cit64ServiceRules = {
  async requireHostTenantAdmin(...args) {
    assert.equal(args.length, 1);
    assert.equal(new URL(args[0].url).hostname, "tenant-a.example.test");
    state.events.push("auth:start");
    await Promise.resolve();
    if (state.failure === "auth") throw new Error(privateError.message);
    state.events.push("auth:end");
    state.authorized = state.access.ok;
    return state.access;
  },
  supabaseServer: { from(table) {
    state.events.push(table);
    assert.equal(state.authorized, true);
    assert.ok(["professionals", "services", "service_availability_rules"].includes(table));
    return new Query(table);
  } },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = { "next/server": "next", "@/lib/supabaseServer": "supabaseServer", "@/lib/api/requireTenantAdmin": "requireHostTenantAdmin" };
    if (mocks[specifier]) return { url: `cit64-service-rules:${mocks[specifier]}`, shortCircuit: true };
    if (specifier === "@/lib/api/validators") return { url: pathToFileURL(resolve("lib/api/validators.ts")).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "cit64-service-rules:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    if (url.startsWith("cit64-service-rules:")) {
      const name = url.split(":")[1];
      return { format: "module", source: `export const ${name} = globalThis.__cit64ServiceRules.${name};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { POST } = await import(pathToFileURL(resolve("app/api/admin/service-rules/upsert/route.ts")).href);
const item = () => ({ id: "client-supplied-id", tenant_id: B, professional_id: PB, service_id: SB, day_of_week: 7, start_time: "09:30:00", end_time: "10:30:00", is_active: false });
const input = () => ({ tenantId: B, professionalId: PA, serviceId: SA, items: [item()] });
test.beforeEach((t) => {
  Object.assign(state, { access: { ok: true, tenantId: A }, authorized: false, events: [], queries: [], failure: null, throwError: false,
    professionals: [{ id: PA, tenant_id: A }, { id: PB, tenant_id: B }],
    services: [{ id: SA, tenant_id: A }, { id: SB, tenant_id: B }],
    service_availability_rules: [
      { id: "old-a", tenant_id: A, professional_id: PA, service_id: SA },
      { id: "other-professional", tenant_id: A, professional_id: MISSING, service_id: SA },
      { id: "other-service", tenant_id: A, professional_id: PA, service_id: MISSING },
      { id: "foreign", tenant_id: B, professional_id: PB, service_id: SB },
    ],
  });
  t.mock.method(console, "error", () => {});
});
async function request(body = input(), malformed = false) {
  const req = new Request("https://tenant-a.example.test/api/admin/service-rules/upsert", { method: "POST", body: malformed ? "{" : JSON.stringify(body) });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await POST(req);
  return { status: response.status, headers: [...response.headers], body: await response.json() };
}
for (const status of [401, 403, 400, 500]) {
  test(`auth rejection ${status} precedes JSON and every query`, async () => {
    state.access = { ok: false, status, error: status === 500 ? privateError.message : "Authorization failed" };
    const result = await request(null, true);
    assert.equal(result.status, status);
    assert.doesNotMatch(JSON.stringify(result), /private|details|hint/);
    assert.deepEqual(state.events, ["auth:start", "auth:end"]);
    assert.equal(state.queries.length, 0);
  });
}
for (const hint of [B, undefined, { invalid: true }]) {
  test(`REPLACE permits own entities and ignores tenant hint ${JSON.stringify(hint)}`, async () => {
    const untouched = structuredClone(state.service_availability_rules.slice(1));
    const result = await request({ ...input(), tenantId: hint });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, inserted: 1, replaced: true });
    assert.deepEqual(state.events.slice(0, 3), ["auth:start", "auth:end", "json"]);
    assert.equal(state.queries.length, 4);
    const [professional, service, deletion, insertion] = state.queries;
    assert.equal(professional.table, "professionals");
    assert.equal(service.table, "services");
    assert.equal(professional.columns, "id");
    assert.equal(service.columns, "id");
    assert.deepEqual(professional.filters, [["id", PA], ["tenant_id", A]]);
    assert.deepEqual(service.filters, [["id", SA], ["tenant_id", A]]);
    assert.equal(deletion.operation, "delete");
    assert.deepEqual(deletion.filters, [["tenant_id", A], ["professional_id", PA], ["service_id", SA]]);
    assert.equal(insertion.operation, "insert");
    assert.deepEqual(insertion.rows, [{ tenant_id: A, professional_id: PA, service_id: SA, day_of_week: 0, start_time: "09:30", end_time: "10:30", is_active: false }]);
    assert.deepEqual(state.service_availability_rules, [...untouched, ...insertion.rows]);
  });
}
for (const [field, foreignId] of [["professionalId", PB], ["serviceId", SB]]) {
  for (const items of [[item()], []]) {
    test(`${field} foreign and missing share generic 400 with items length ${items.length}`, async () => {
      const before = structuredClone(state.service_availability_rules);
      const foreign = await request({ ...input(), items, [field]: foreignId });
      const missing = await request({ ...input(), items, [field]: MISSING });
      assert.equal(foreign.status, 400);
      assert.deepEqual(foreign.body, { error: `${field} inválido` });
      assert.deepEqual(foreign, missing);
      assert.ok(state.queries.every((q) => q.operation === "read"));
      assert.deepEqual(state.service_availability_rules, before);
    });
  }
}
test("items=[] validates both entities then deletes only the selected rules", async () => {
  const untouched = structuredClone(state.service_availability_rules.slice(1));
  const result = await request({ ...input(), items: [] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, inserted: 0, replaced: true });
  assert.deepEqual(state.queries.map((q) => [q.table, q.operation]), [["professionals", "read"], ["services", "read"], ["service_availability_rules", "delete"]]);
  assert.deepEqual(state.service_availability_rules, untouched);
});
test("normalization preserves weekdays, time slices, active defaults and id removal", async () => {
  const days = [0, 1, 6, 7, 8, -1, "invalid", "2"];
  const items = days.map((day_of_week) => ({ id: "discard", day_of_week, start_time: "08:15:00", end_time: "09:45:00" }));
  assert.equal((await request({ ...input(), items })).status, 200);
  const rows = state.queries.at(-1).rows;
  assert.deepEqual(rows.map((row) => row.day_of_week), [0, 1, 6, 0, 1, 6, 0, 2]);
  assert.ok(rows.every((row) => row.start_time === "08:15" && row.end_time === "09:45" && row.is_active === true && !Object.hasOwn(row, "id")));
});
for (const field of ["professionalId", "serviceId"]) {
  for (const value of [undefined, "invalid", 123]) {
    test(`${field} ${value} is invalid after auth without DB`, async () => {
      const result = await request({ ...input(), [field]: value });
      assert.equal(result.status, 400);
      assert.deepEqual(result.body, { error: `${field} inválido` });
      assert.deepEqual(state.events, ["auth:start", "auth:end", "json"]);
      assert.equal(state.queries.length, 0);
    });
  }
}
test("non-array items are rejected before DB", async () => {
  assert.equal((await request({ ...input(), items: {} })).status, 400);
  assert.equal(state.queries.length, 0);
});
test("malformed JSON is rejected after auth without DB", async () => {
  assert.equal((await request(null, true)).status, 400);
  assert.deepEqual(state.events, ["auth:start", "auth:end", "json"]);
});
for (const stage of ["professionals", "services", "delete", "insert"]) {
  for (const throwError of [false, true]) {
    test(`${stage} failure (${throwError}) exposes no DB internals`, async () => {
      state.failure = stage;
      state.throwError = throwError;
      const result = await request();
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { error: "Error inesperado" });
      assert.doesNotMatch(JSON.stringify(result), /private|details|hint/);
      if (["professionals", "services"].includes(stage)) assert.ok(state.queries.every((q) => q.operation === "read"));
      if (stage === "delete") assert.ok(state.queries.every((q) => q.operation !== "insert"));
    });
  }
}
test("auth exception is generic and stops before body", async () => {
  state.failure = "auth";
  const result = await request();
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: "Error inesperado" });
  assert.deepEqual(state.events, ["auth:start"]);
});
