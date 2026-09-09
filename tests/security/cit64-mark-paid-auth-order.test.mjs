import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID = "11111111-1111-4111-8111-111111111111";
const privateError = { message: "private message", details: "private details", hint: "private hint", code: "private code" };
const state = {};
class TenantOperationalError extends Error {}
// Real handler and UUID validator; auth, capabilities, RPC, DB and notification simulated.
globalThis.__cit64MarkPaid = {
  TenantOperationalError,
  async requireHostTenantAdmin(req) {
    state.events.push("auth:start");
    await Promise.resolve();
    assert.equal(new URL(req.url).hostname, "tenant-a.example.test");
    if (state.failure === "auth") throw new Error(privateError.message);
    state.events.push("auth:end");
    return state.access;
  },
  async assertTenantCanConfirmTransfer(tenantId) {
    state.events.push("capability");
    state.capabilities.push(tenantId);
    if (state.failure === "capability") throw new Error(privateError.message);
    if (state.blocked) throw new TenantOperationalError(privateError.message);
    return { capabilities: { sendExternalEmail: state.sendEmail } };
  },
  async notifyPaymentConfirmed(payload) {
    state.events.push("notify");
    state.notifications.push(payload);
    if (state.failure === "notify") throw new Error(privateError.message);
  },
  supabaseAdmin: {
    async rpc(name, args) {
      state.events.push("rpc");
      state.rpcs.push({ name, args });
      if (state.failure === "rpc:throw") throw new Error(privateError.message);
      return state.failure === "rpc:error" ? { data: null, error: privateError } : { data: "intent-a", error: null };
    },
    from(table) {
      const query = { table, filters: [], select(columns) { this.columns = columns; return this; }, eq(key, value) { this.filters.push([key, value]); return this; }, async maybeSingle() {
        state.events.push("read");
        state.queries.push(this);
        if (state.failure === "read:throw") throw new Error(privateError.message);
        if (state.failure === "read:error") return { data: null, error: privateError };
        return { data: { payment_status: "paid", payment_remaining_amount: 0 }, error: null };
      } };
      return query;
    },
  },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = { "next/server": "next", "@/lib/supabaseAdmin": "db", "@/lib/api/requireTenantAdmin": "auth", "@/lib/tenant/operational-server": "operational", "@/services/automations/notify-payment-confirmed": "notify" };
    if (map[specifier]) return { url: `cit64-mark-paid:${map[specifier]}`, shortCircuit: true };
    if (specifier === "@/lib/api/validators") return { url: pathToFileURL(resolve("lib/api/validators.ts")).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "cit64-mark-paid:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    const groups = { db: ["supabaseAdmin"], auth: ["requireHostTenantAdmin"], operational: ["assertTenantCanConfirmTransfer", "TenantOperationalError"], notify: ["notifyPaymentConfirmed"] };
    const names = groups[url.replace("cit64-mark-paid:", "")];
    if (names) return { format: "module", source: names.map((name) => `export const ${name} = globalThis.__cit64MarkPaid.${name};`).join("\n"), shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { POST } = await import(pathToFileURL(resolve("app/api/admin/appointments/mark-paid/route.ts")).href);
test.beforeEach((t) => {
  Object.assign(state, { access: { ok: true, tenantId: A, userId: "admin-a" }, events: [], capabilities: [], notifications: [], rpcs: [], queries: [], failure: null, blocked: false, sendEmail: true });
  t.mock.method(console, "error", () => {});
});
async function request(body = { appointmentId: ID }, malformed = false) {
  const req = new Request("https://tenant-a.example.test/api/admin/appointments/mark-paid", { method: "POST", body: malformed ? "{" : JSON.stringify(body) });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await POST(req);
  return { status: response.status, body: await response.json() };
}
for (const status of [401, 403, 400, 500]) {
  test(`auth rejection ${status} precedes malformed JSON and all effects`, async () => {
    state.access = { ok: false, status, error: "Authorization failed" };
    const result = await request(null, true);
    assert.equal(result.status, status);
    assert.deepEqual(state.events, ["auth:start", "auth:end"]);
    assert.equal(state.rpcs.length, 0);
    assert.equal(state.queries.length, 0);
    assert.equal(state.notifications.length, 0);
  });
}
for (const hint of [B, undefined, "invalid"]) {
  test(`body tenant hint ${hint} cannot select tenant or actor`, async () => {
    const result = await request({ appointmentId: ` ${ID} `, tenantId: hint, tenant_id: hint, userId: "attacker", actorId: "attacker" });
    assert.deepEqual(result, { status: 200, body: { ok: true, appointmentId: ID, payment_status: "paid", payment_remaining_amount: 0, paymentIntentId: "intent-a" } });
    assert.deepEqual(state.events, ["auth:start", "auth:end", "json", "capability", "rpc", "notify", "read"]);
    assert.deepEqual(state.capabilities, [A]);
    assert.deepEqual(state.rpcs, [{ name: "billing_record_manual_verified_payment", args: { p_tenant_id: A, p_appointment_id: ID, p_actor_id: "admin-a" } }]);
    assert.equal(state.queries.length, 1);
    assert.equal(state.queries[0].table, "appointments");
    assert.equal(state.queries[0].columns, "payment_status,payment_remaining_amount");
    assert.deepEqual(state.queries[0].filters, [["tenant_id", A], ["id", ID]]);
    assert.deepEqual(state.notifications, [{ appointmentId: ID, provider: "manual", externalPaymentId: `manual:${ID}` }]);
  });
}
for (const mode of ["malformed", "missing", "invalid"]) {
  test(`${mode} appointment input is rejected after auth without RPC`, async () => {
    const result = await request(mode === "invalid" ? { appointmentId: "bad" } : {}, mode === "malformed");
    assert.deepEqual(result, { status: 400, body: { ok: false, error: "appointmentId inválido" } });
    assert.deepEqual(state.events, ["auth:start", "auth:end", "json"]);
    assert.equal(state.rpcs.length, 0);
  });
}
for (const stage of ["auth", "capability", "rpc:throw", "rpc:error", "notify", "read:throw", "read:error"]) {
  test(`${stage} internal failure remains generic`, async () => {
    state.failure = stage;
    const result = await request();
    assert.equal(result.status, stage === "read:error" ? 200 : 500);
    assert.doesNotMatch(JSON.stringify(result), /private|details|hint/);
    if (stage === "auth") assert.deepEqual(state.events, ["auth:start"]);
    if (["auth", "capability"].includes(stage)) assert.equal(state.rpcs.length, 0);
    if (stage.startsWith("rpc:")) assert.equal(state.notifications.length, 0);
    if (stage === "read:error") {
      assert.equal(result.body.payment_status, "partially_paid");
      assert.equal(result.body.payment_remaining_amount, null);
    }
  });
}
test("capability denial preserves 409 without payment RPC", async () => {
  state.blocked = true;
  const result = await request();
  assert.equal(result.status, 409);
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.equal(state.rpcs.length, 0);
});
test("email capability disabled preserves payment and skips notification", async () => {
  state.sendEmail = false;
  assert.equal((await request()).status, 200);
  assert.equal(state.rpcs.length, 1);
  assert.equal(state.queries.length, 1);
  assert.equal(state.notifications.length, 0);
});
