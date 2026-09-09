import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FOREIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EXPLICIT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const state = {};
const secret = { message: "private database message", details: "private details", hint: "private hint" };

class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = "select"; }
  select(columns) { this.columns = columns; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  in(key, values) { this.filters.push([key, values]); return this; }
  order() { return this; }
  single() { this.one = true; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(rows) { this.op = "upsert"; this.rows = rows; return this; }
  insert(rows) { this.op = "insert"; this.rows = rows; return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => {
      const stage = this.table === "professionals" ? "professional" : this.op === "select" ? (this.columns === "id" ? "existing" : "final") : this.op;
      state.queries.push(this);
      if (state.throwAt === stage) throw new Error(secret.message);
      if (state.errorAt === stage) return { data: null, error: secret };
      const matches = (row) => this.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
      const rows = state[this.table];
      if (this.op === "delete") state[this.table] = rows.filter((row) => !matches(row));
      if (this.op === "upsert") {
        for (const row of this.rows) Object.assign(rows.find((r) => r.id === row.id), row);
      }
      if (this.op === "insert") rows.push(...this.rows.map((row) => ({ id: "new-id", ...row })));
      const data = rows.filter(matches);
      return { data: this.one ? data[0] ?? null : data, error: null };
    }).then(resolve, reject);
  }
}
// Real handler, mocked boundary and database; no remote calls. The helper's
// internal hostname lookup is unchanged and outside this route-level test.
globalThis.__cit64Availability = {
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
      assert.ok(["professionals", "availability"].includes(table), "No manual tenant lookup");
      return new Query(table);
    },
  },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = { "next/server": "next", "@/lib/supabaseAdmin": "db", "@/lib/api/requireTenantAdmin": "auth" };
    if (map[specifier]) return { url: `cit64-availability:${map[specifier]}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const map = {
      "cit64-availability:next": "export const NextResponse = Response;",
      "cit64-availability:db": "export const supabaseAdmin = globalThis.__cit64Availability.supabaseAdmin;",
      "cit64-availability:auth": "export const requireHostTenantAdmin = globalThis.__cit64Availability.requireHostTenantAdmin;",
    };
    if (map[url]) return { format: "module", source: map[url], shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { POST } = await import(pathToFileURL(resolve("app/api/admin/availability/upsert/route.ts")).href);
const block = (id, day = 1) => ({ id, day_of_week: day, start_time: "09:00:00", end_time: "10:00:00" });
const payload = () => ({ professionalId: PA, items: [block(ID), { ...block(EXPLICIT), is_active: false }, block(null, 2)] });

test.beforeEach(() => {
  Object.assign(state, {
    access: { ok: true, tenantId: A }, events: [], queries: [], errorAt: null, throwAt: null,
    professionals: [{ id: PA, tenant_id: A }, { id: PB, tenant_id: B }],
    availability: [ID, MISSING, EXPLICIT].map((id) => ({ ...block(id), tenant_id: A, professional_id: PA })).concat([{ ...block(FOREIGN), tenant_id: B, professional_id: PB }]),
  });
});
async function request(body = payload()) {
  const req = new Request("https://tenant-a.citaya.test/api/admin/availability/upsert", { method: "POST", body: JSON.stringify(body) });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await POST(req);
  assert.match(response.headers.get("cache-control"), /no-store/);
  return { response, body: await response.json() };
}
for (const status of [401, 403, 400, 500]) {
  test(`boundary failure ${status} precedes JSON, validation and every database call`, async () => {
    state.access = { ok: false, status, error: secret.message };
    const result = await request({});
    assert.equal(result.response.status, status);
    assert.deepEqual(result.body, { error: status === 401 ? "Unauthorized" : "Forbidden" });
    assert.deepEqual(state.events, ["auth:start", "auth:end"]);
    assert.equal(state.queries.length, 0);
  });
}
for (const injected of [false, true]) {
  test(`tenant A updates, inserts and deletes only its professional's availability (injected tenant B: ${injected})`, async () => {
    const foreignBefore = structuredClone(state.availability.find((row) => row.id === FOREIGN));
    const result = await request({ ...payload(), ...(injected ? { tenantId: B } : {}) });
    assert.equal(result.response.status, 200);
    assert.deepEqual(state.events.slice(0, 3), ["auth:start", "auth:end", "json"]);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.updated, 1);
    assert.equal(result.body.inserted, 1);
    assert.equal(result.body.deleted, 2);
    assert.equal(result.body.items.length, 2);
    assert.deepEqual(state.availability.find((row) => row.id === FOREIGN), foreignBefore);
    for (const q of state.queries) {
      if (["insert", "upsert"].includes(q.op)) {
        for (const row of q.rows) {
          assert.equal(row.tenant_id, A);
          assert.equal(row.professional_id, PA);
          assert.equal(row.start_time, "09:00");
        }
      } else {
        assert.ok(q.filters.some(([key, value]) => key === "tenant_id" && value === A));
        assert.ok(q.filters.some(([key, value]) => key === (q.table === "professionals" ? "id" : "professional_id") && value === PA));
      }
    }
    assert.deepEqual(state.queries.find((q) => q.op === "delete").filters.find(([key]) => key === "id")[1].sort(), [EXPLICIT, MISSING].sort());
  });
}
test("tenant A cannot use professional B", async () => {
  const before = structuredClone(state.availability);
  const result = await request({ ...payload(), professionalId: PB });
  assert.equal(result.response.status, 403);
  assert.deepEqual(state.availability, before);
  assert.deepEqual(state.events, ["auth:start", "auth:end", "json", "professionals"]);
});
for (const active of [true, false]) {
  test(`foreign availability id cannot be updated or deleted (active: ${active})`, async () => {
    const before = structuredClone(state.availability);
    const result = await request({ professionalId: PA, items: [{ ...block(FOREIGN), is_active: active }] });
    assert.equal(result.response.status, 403);
    assert.deepEqual(state.availability, before);
    assert.ok(state.queries.every((q) => q.op === "select"));
  });
}
test("invalid payload is rejected after authentication", async () => {
  assert.equal((await request({})).response.status, 400);
  assert.deepEqual(state.events, ["auth:start", "auth:end", "json"]);
});
for (const stage of ["professional", "existing", "delete", "upsert", "insert", "final"]) {
  test(`database error at ${stage} never exposes message/details/hint`, async () => {
    state.errorAt = stage;
    const result = await request();
    assert.equal(result.response.status, stage === "professional" ? 403 : 500);
    assert.deepEqual(result.body, { error: stage === "professional" ? "profesional inválido para este tenant" : "Error interno" });
  });
}
test("unexpected database exception returns generic 500", async () => {
  state.throwAt = "existing";
  const result = await request();
  assert.equal(result.response.status, 500);
  assert.deepEqual(result.body, { error: "Error interno" });
});
