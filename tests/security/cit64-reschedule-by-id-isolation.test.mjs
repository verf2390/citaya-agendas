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
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  neq(key, value) { this.filters.push([key, value, "neq"]); return this; }
  lt(key, value) { this.filters.push([key, value, "lt"]); return this; }
  gt(key, value) { this.filters.push([key, value, "gt"]); return this; }
  limit() { this.overlap = true; return this; }
  single() { return this; }
  update(row) { this.row = row; return this; }
  maybeSingle() { return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => {
      state.queries.push(this);
      const stage = this.table === "tenants" ? "tenant" : this.row ? "update" : this.overlap ? "overlap" : "read";
      if (state.throws === stage) throw new Error(secretError.message);
      if (state.error === stage) return { data: null, error: secretError };
      if (this.table === "tenants") return { data: { admin_email: "admin-a@example.test" }, error: null };
      if (this.overlap) return { data: state.conflict ? [{ id: "conflict" }] : [], error: null };
      const row = state.appointments.find((row) => this.filters.every(([key, value]) => row[key] === value));
      if (row && this.row) Object.assign(row, this.row);
      return { data: row ? structuredClone(row) : null, error: null };
    }).then(resolve, reject);
  }
}
// Real handler; boundary, DB and external effects are simulated. This does not
// test or change the hostname helper's internal lookup before bearer validation.
globalThis.__cit64Reschedule = {
  async requireHostTenantAdmin(req) {
    state.events.push("auth:start");
    await Promise.resolve();
    assert.equal(new URL(req.url).hostname, "tenant-a.citaya.test");
    state.events.push("auth:end");
    return state.access;
  },
  supabaseAdmin: { from(table) { state.events.push(table); assert.ok(["appointments", "tenants"].includes(table)); return new Query(table); } },
  async assertTenantCanCreateAppointment(id) { state.capabilities.push(["create", id]); if (state.blockCreate) throw new Error("blocked"); },
  async assertTenantCanRunAppointmentOperationalEffects(id) { state.capabilities.push(["effects", id]); if (state.blockEffects) throw new Error("blocked"); },
  async notifyWaitlistSlotReleased(payload) { state.waitlist.push(payload); },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = { "next/server": "next", "@/lib/supabaseAdmin": "db", "@/lib/api/requireTenantAdmin": "auth", "@/lib/tenant/operational-server": "operational", "@/services/automations/notify-waitlist-slot-released": "waitlist" };
    if (map[specifier]) return { url: `cit64-reschedule:${map[specifier]}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const names = { db: ["supabaseAdmin"], auth: ["requireHostTenantAdmin"], operational: ["assertTenantCanCreateAppointment", "assertTenantCanRunAppointmentOperationalEffects"], waitlist: ["notifyWaitlistSlotReleased"] };
    if (url === "cit64-reschedule:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    const group = names[url.replace("cit64-reschedule:", "")];
    if (group) return { format: "module", source: group.map((name) => `export const ${name} = globalThis.__cit64Reschedule.${name};`).join("\n"), shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { POST } = await import(pathToFileURL(resolve("app/api/appointments/reschedule-by-id/route.ts")).href);
test.beforeEach((t) => {
  const previousUrl = process.env.N8N_RESCHEDULE_WEBHOOK_URL;
  process.env.N8N_RESCHEDULE_WEBHOOK_URL = "https://notification.test/reschedule";
  t.after(() => { if (previousUrl === undefined) delete process.env.N8N_RESCHEDULE_WEBHOOK_URL; else process.env.N8N_RESCHEDULE_WEBHOOK_URL = previousUrl; });
  const previous = process.env.CITAYA_SECRET;
  process.env.CITAYA_SECRET = "test-only-secret";
  t.after(() => { if (previous === undefined) delete process.env.CITAYA_SECRET; else process.env.CITAYA_SECRET = previous; });
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  Object.assign(state, { access: { ok: true, tenantId: A }, events: [], queries: [], capabilities: [], waitlist: [], fetches: [], error: null, throws: null, blockCreate: false, blockEffects: false, network: "ok", conflict: false, appointments: [
    { id: ID, tenant_id: A, status: "confirmed", booking_status: "confirmed", professional_id: "pro-a", end_at: "2026-09-10T11:00:00Z", service_id: "service-a", start_at: "2026-09-10T10:00:00Z" },
    { id: FOREIGN, tenant_id: B, status: "confirmed", booking_status: "confirmed" },
  ] });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    state.fetches.push({ url, init });
    if (state.network === "throw") throw new Error(secretError.message);
    return Response.json(state.network === "http" ? secretError : { ok: true }, { status: state.network === "http" ? 500 : 200 });
  });
});
const input = (id = ID) => ({ appointment_id: id, tenant_id: B, new_start_at: "2026-09-11T10:00:00Z", new_end_at: "2026-09-11T11:00:00Z" });
async function request(body = input()) {
  const req = new Request("https://tenant-a.citaya.test/api/appointments/reschedule-by-id", { method: "POST", body: JSON.stringify(body) });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await POST(req);
  return { status: response.status, headers: [...response.headers], body: await response.json() };
}
for (const status of [401, 403, 400, 500]) {
  test(`auth failure ${status} precedes JSON and DB`, async () => {
    state.access = { ok: false, status, error: secretError.message };
    const result = await request(null);
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { ok: false, error: status === 401 ? "Unauthorized" : "Forbidden" });
    assert.deepEqual(state.events, ["auth:start", "auth:end"]);
    assert.equal(state.queries.length, 0);
  });
}
for (const hint of [B, undefined, "invalid"]) {
  test(`reschedule uses A throughout despite tenant hint ${hint}`, async () => {
    const beforeB = structuredClone(state.appointments[1]);
    const result = await request({ ...input(), tenant_id: hint });
    assert.equal(result.status, 200);
    assert.equal(result.body.appointment.start_at, "2026-09-11T10:00:00.000Z");
    assert.equal(result.body.appointment.end_at, "2026-09-11T11:00:00.000Z");
    assert.ok(Date.parse(result.body.appointment.rescheduled_at));
    assert.equal(result.body.appointment.status, "confirmed");
    assert.deepEqual(state.events.slice(0, 3), ["auth:start", "auth:end", "json"]);
    assert.equal(state.queries.length, 4);
    for (const q of state.queries) {
      if (q.table === "tenants") assert.deepEqual(q.filters, [["id", A]]);
      else if (!q.overlap) assert.deepEqual(q.filters, [["id", ID], ["tenant_id", A]]);
      else assert.deepEqual(q.filters, [["tenant_id", A], ["professional_id", "pro-a"], ["booking_status", "confirmed"], ["id", ID, "neq"], ["start_at", "2026-09-11T11:00:00.000Z", "lt"], ["end_at", "2026-09-11T10:00:00.000Z", "gt"]]);
    }
    assert.deepEqual(state.capabilities, [["create", A], ["effects", A]]);
    assert.deepEqual(state.waitlist, [{ tenantId: A, serviceId: "service-a", startAt: "2026-09-10T10:00:00Z" }]);
    const payload = JSON.parse(state.fetches[0].init.body);
    assert.equal(payload.tenant_id, A);
    assert.equal(payload.admin_email, "admin-a@example.test");
    assert.ok(state.fetches[0].init.signal instanceof AbortSignal);
    assert.deepEqual(state.appointments[1], beforeB);
  });
}
test("foreign and missing appointments have identical observable 404 and no mutations", async () => {
  const before = structuredClone(state.appointments);
  const foreign = await request(input(FOREIGN));
  const missing = await request(input(MISSING));
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign, missing);
  assert.deepEqual(state.appointments, before);
  assert.ok(state.queries.every((q) => !q.row));
  assert.equal(state.fetches.length, 0);
  assert.equal(state.waitlist.length, 0);
});
for (const reason of ["canceled", "overlap"]) {
  test(`${reason} still returns 409 without update`, async () => {
    if (reason === "canceled") state.appointments[0].status = "canceled";
    else state.conflict = true;
    const result = await request();
    assert.equal(result.status, 409);
    assert.ok(state.queries.every((q) => !q.row));
    assert.equal(state.fetches.length, 0);
  });
}
test("invalid range remains 400 after auth", async () => {
  const result = await request({ ...input(), new_end_at: "2026-09-11T09:00:00Z" });
  assert.equal(result.status, 400);
  assert.equal(state.queries.length, 0);
});
for (const stage of ["read", "overlap", "update"]) {
  for (const kind of ["error", "throws"]) {
    test(`DB ${stage} ${kind} is generic`, async () => {
      state[kind] = stage;
      const result = await request();
      assert.equal(result.status, 500);
      assert.deepEqual(Object.keys(result.body).sort(), ["error", "ok"]);
      assert.doesNotMatch(JSON.stringify(result.body), /private|details|hint/);
    });
  }
}
for (const mode of ["throw", "http", "ok"]) {
  test(`n8n ${mode} never exposes raw provider body or exception`, async () => {
    state.network = mode;
    const result = await request();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.n8n.result, mode === "ok" ? { ok: true } : "notification_failed");
    assert.equal(result.body.n8n.ok, mode === "ok");
  });
}
test("tenant email read failure is not exposed and reschedule succeeds", async () => {
  state.error = "tenant";
  const result = await request();
  assert.equal(result.status, 200);
  assert.doesNotMatch(JSON.stringify(result.body), /private|details|hint/);
});
test("operational effects denial skips notification without blocking reschedule", async () => {
  state.blockEffects = true;
  assert.equal((await request()).status, 200);
  assert.equal(state.fetches.length, 0);
});

test("creation capability denial stops reschedule before DB and effects", async () => {
  state.blockCreate = true;
  assert.equal((await request()).status, 409);
  assert.deepEqual(state.capabilities, [["create", A]]);
  assert.equal(state.queries.length, 0);
  assert.equal(state.waitlist.length, 0);
  assert.equal(state.fetches.length, 0);
});

for (const reason of ["unconfirmed", "unchanged start"]) {
  test(`waitlist is skipped for ${reason}`, async () => {
    if (reason === "unconfirmed") state.appointments[0].booking_status = "pending";
    else state.appointments[0].start_at = "2026-09-11T10:00:00.000Z";
    assert.equal((await request()).status, 200);
    assert.equal(state.waitlist.length, 0);
  });
}

for (const field of ["new_start_at", "new_end_at"]) {
  test(`malformed ${field} preserves generic rejection without mutation`, async () => {
    const result = await request({ ...input(), [field]: "invalid-date" });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { ok: false, error: "Error interno" });
    assert.equal(state.queries.length, 0);
    assert.equal(state.waitlist.length, 0);
    assert.equal(state.fetches.length, 0);
  });
}

test("n8n timeout aborts after 5000ms, clears timer and preserves reschedule", async (t) => {
  let expire;
  const timer = {};
  t.mock.method(globalThis, "setTimeout", (callback, ms) => {
    assert.equal(ms, 5000);
    expire = callback;
    return timer;
  });
  const clear = t.mock.method(globalThis, "clearTimeout", (handle) => assert.equal(handle, timer));
  t.mock.method(globalThis, "fetch", async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error(secretError.message)), { once: true });
    expire();
    assert.equal(init.signal.aborted, true);
  }));
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.body.appointment.start_at, "2026-09-11T10:00:00.000Z");
  assert.deepEqual(result.body.n8n, { called: true, ok: false, status: 0, result: "notification_failed" });
  assert.equal(clear.mock.callCount(), 1);
});
