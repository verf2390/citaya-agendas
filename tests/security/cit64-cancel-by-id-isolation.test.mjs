import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MISSING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const state = {};
const secretError = { message: "private message", details: "private details", hint: "private hint" };
class Query {
  constructor() { this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  update(row) { this.row = row; return this; }
  maybeSingle() { return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => {
      state.queries.push(this);
      const stage = this.row ? "update" : "read";
      if (state.throws === stage) throw new Error(secretError.message);
      if (state.error === stage) return { data: null, error: secretError };
      const row = state.appointments.find((row) => this.filters.every(([key, value]) => row[key] === value));
      if (row && this.row) Object.assign(row, this.row);
      return { data: row ? structuredClone(row) : null, error: null };
    }).then(resolve, reject);
  }
}
// Real handler; boundary, DB and external effects are simulated. This does not
// test or change the hostname helper's internal lookup before bearer validation.
globalThis.__cit64Cancel = {
  async requireHostTenantAdmin(req) {
    state.events.push("auth:start");
    await Promise.resolve();
    assert.equal(new URL(req.url).hostname, "tenant-a.citaya.test");
    state.events.push("auth:end");
    return state.access;
  },
  supabaseAdmin: { from(table) { state.events.push(table); assert.equal(table, "appointments"); return new Query(); } },
  async assertTenantCanCreateAppointment(id) { state.capabilities.push(["create", id]); if (state.blockCreate) throw new Error("blocked"); },
  async assertTenantCanRunAppointmentOperationalEffects(id) { state.capabilities.push(["effects", id]); if (state.blockEffects) throw new Error("blocked"); },
  async notifyWaitlistSlotReleased(payload) { state.waitlist.push(payload); },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = { "next/server": "next", "@/lib/supabaseAdmin": "db", "@/lib/api/requireTenantAdmin": "auth", "@/lib/tenant/operational-server": "operational", "@/services/automations/notify-waitlist-slot-released": "waitlist" };
    if (map[specifier]) return { url: `cit64-cancel:${map[specifier]}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const names = { db: ["supabaseAdmin"], auth: ["requireHostTenantAdmin"], operational: ["assertTenantCanCreateAppointment", "assertTenantCanRunAppointmentOperationalEffects"], waitlist: ["notifyWaitlistSlotReleased"] };
    if (url === "cit64-cancel:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    const group = names[url.replace("cit64-cancel:", "")];
    if (group) return { format: "module", source: group.map((name) => `export const ${name} = globalThis.__cit64Cancel.${name};`).join("\n"), shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { POST } = await import(pathToFileURL(resolve("app/api/appointments/cancel-by-id/route.ts")).href);
test.beforeEach((t) => {
  const previous = process.env.CITAYA_SECRET;
  process.env.CITAYA_SECRET = "test-only-secret";
  t.after(() => { if (previous === undefined) delete process.env.CITAYA_SECRET; else process.env.CITAYA_SECRET = previous; });
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  Object.assign(state, { access: { ok: true, tenantId: A }, events: [], queries: [], capabilities: [], waitlist: [], fetches: [], error: null, throws: null, blockCreate: false, blockEffects: false, network: "ok", appointments: [
    { id: ID, tenant_id: A, status: "confirmed", booking_status: "confirmed", service_id: "service-a", start_at: "2026-09-10T10:00:00Z" },
    { id: FOREIGN, tenant_id: B, status: "confirmed", booking_status: "confirmed" },
  ] });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    state.fetches.push({ url, init });
    if (state.network === "throw") throw new Error(secretError.message);
    return Response.json(state.network === "http" ? secretError : { ok: true }, { status: state.network === "http" ? 500 : 200 });
  });
});
async function request(body = { appointment_id: ID, tenant_id: B }) {
  const req = new Request("https://tenant-a.citaya.test/api/appointments/cancel-by-id", { method: "POST", body: JSON.stringify(body) });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await POST(req);
  return { status: response.status, headers: [...response.headers], body: await response.json() };
}
for (const status of [401, 403, 400, 500]) {
  test(`auth failure ${status} precedes JSON and appointments access`, async () => {
    state.access = { ok: false, status, error: secretError.message };
    const result = await request(null);
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { ok: false, error: status === 401 ? "Unauthorized" : "Forbidden" });
    assert.deepEqual(state.events, ["auth:start", "auth:end"]);
    assert.deepEqual(state.capabilities, []);
  });
}
for (const hint of [B, undefined, "invalid"]) {
  test(`own cancellation ignores body tenant hint ${hint}`, async () => {
    const beforeB = structuredClone(state.appointments[1]);
    const result = await request({ appointment_id: ID, tenant_id: hint });
    assert.equal(result.status, 200);
    assert.equal(result.body.appointment.status, "canceled");
    assert.equal(result.body.appointment.booking_status, "cancelled");
    assert.deepEqual(state.events.slice(0, 3), ["auth:start", "auth:end", "json"]);
    assert.equal(state.queries.length, 2);
    for (const q of state.queries) assert.deepEqual(q.filters, [["id", ID], ["tenant_id", A]]);
    assert.deepEqual(state.capabilities, [["create", A], ["effects", A]]);
    assert.deepEqual(state.waitlist, [{ tenantId: A, serviceId: "service-a", startAt: "2026-09-10T10:00:00Z" }]);
    assert.equal(JSON.parse(state.fetches[0].init.body).tenant_id, A);
    assert.equal(state.fetches[0].init.signal instanceof AbortSignal, true);
    assert.deepEqual(state.appointments[1], beforeB);
  });
}
test("foreign and nonexistent IDs return identical 404 without mutation or effects", async () => {
  const before = structuredClone(state.appointments);
  const foreign = await request({ appointment_id: FOREIGN, tenant_id: B });
  const missing = await request({ appointment_id: MISSING });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign, missing);
  assert.deepEqual(state.appointments, before);
  assert.ok(state.queries.every((q) => !q.row));
  assert.deepEqual(state.waitlist, []);
  assert.deepEqual(state.fetches, []);
});
test("already canceled is idempotent without update or notifications", async () => {
  state.appointments[0].status = "canceled";
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.n8n.result, { ok: true, skipped: "already_canceled" });
  assert.equal(state.queries.length, 1);
  assert.deepEqual(state.waitlist, []);
  assert.deepEqual(state.fetches, []);
});
for (const stage of ["read", "update"]) {
  for (const kind of ["error", "throws"]) {
    test(`DB ${stage} ${kind} does not expose internal details`, async () => {
      state[kind] = stage;
      const result = await request();
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { ok: false, error: kind === "error" ? "DB error" : "Error interno" });
    });
  }
}
for (const mode of ["throw", "http"]) {
  test(`n8n ${mode} failure is generic and cancellation succeeds`, async () => {
    state.network = mode;
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.body.appointment.status, "canceled");
    assert.deepEqual(result.body.n8n, { called: true, ok: false, result: { ok: false, error: "notification_failed" } });
  });
}
test("create capability denial blocks cancellation", async () => {
  state.blockCreate = true;
  assert.equal((await request()).status, 409);
  assert.equal(state.queries.length, 0);
});
test("communication capability denial preserves cancellation and skips n8n", async () => {
  state.blockEffects = true;
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.body.n8n.result.skipped, "tenant_capability_blocked");
  assert.equal(state.fetches.length, 0);
});
