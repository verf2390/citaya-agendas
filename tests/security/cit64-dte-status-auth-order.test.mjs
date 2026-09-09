import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID = "11111111-1111-4111-8111-111111111111";
const route = "app/api/admin/dte-production/[id]/status/route.ts";
const state = {};
const privateError = { message: "private message", details: "private details", hint: "private hint" };
const fileUrl = (file) => pathToFileURL(resolve(file)).href;
// Real route, production auth adapter, safe error helper and reconciliation planner.
// Host auth, production service and DB are simulated; no SII or SQL calls.
globalThis.__cit64DteStatus = {
  async requireHostTenantAdmin(req) {
    state.events.push("auth:start");
    await Promise.resolve();
    assert.equal(new URL(req.url).hostname, "tenant-a.example.test");
    if (state.failure === "auth") throw new Error(privateError.message);
    state.events.push("auth:end");
    return state.access;
  },
  createServerProductionDteService() {
    return { async queryStatusManually(input) {
      state.events.push("queryStatus");
      state.statusCalls.push(input);
      if (state.failure === "service") throw new Error(privateError.message);
      return { siiStatus: state.siiStatus, responseSha256: "sha-test" };
    } };
  },
  supabaseAdmin: {
    from(table) {
      const query = { table, filters: [], select(columns) { this.columns = columns; return this; }, eq(key, value) { this.filters.push([key, value]); return this; }, async maybeSingle() {
        state.events.push("intent");
        state.queries.push(this);
        if (state.failure === "intent:throw") throw new Error(privateError.message);
        if (state.failure === "intent:error") return { data: null, error: privateError };
        return { data: state.failure === "intent:missing" ? null : { status: state.intentStatus }, error: null };
      } };
      return query;
    },
    async rpc(name, args) {
      state.events.push("rpc");
      state.rpcs.push({ name, args });
      if (state.failure === "rpc:throw") throw new Error(privateError.message);
      return { error: state.failure === "rpc:error" ? privateError : null };
    },
  },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = { "next/server": "next", "@/lib/api/requireTenantAdmin": "auth", "@/lib/dte/production/server": "service", "@/lib/supabaseAdmin": "db" };
    if (mocks[specifier]) return { url: `cit64-dte-status:${mocks[specifier]}`, shortCircuit: true };
    const real = { "@/lib/dte/production/api": "lib/dte/production/api.ts", "@/lib/dte/cutover": "lib/dte/cutover.ts" };
    if (real[specifier]) return { url: fileUrl(real[specifier]), shortCircuit: true };
    if (specifier === "./rut" && context.parentURL === fileUrl("lib/dte/cutover.ts")) return { url: fileUrl("lib/dte/rut.ts"), shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "cit64-dte-status:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    const names = { auth: "requireHostTenantAdmin", service: "createServerProductionDteService", db: "supabaseAdmin" };
    const name = names[url.replace("cit64-dte-status:", "")];
    if (name) return { format: "module", source: `export const ${name} = globalThis.__cit64DteStatus.${name};`, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { POST } = await import(fileUrl(route));
const { safeProductionApiError } = await import(fileUrl("lib/dte/production/api.ts"));
test.beforeEach(() => {
  Object.assign(state, { access: { ok: true, tenantId: A, userId: "admin-a" }, events: [], statusCalls: [], queries: [], rpcs: [], failure: null, siiStatus: "ACCEPTED", intentStatus: "SUBMITTED" });
});
async function request(body) {
  const req = new Request("https://tenant-a.example.test/api/admin/dte-production/document/status", { method: "POST", ...(body === undefined ? {} : { body }) });
  req.json = () => { assert.fail("Body must never be parsed"); };
  const context = { params: { then(accept, reject) {
    state.events.push("params");
    if (state.failure === "params") return Promise.reject(new Error(privateError.message)).then(accept, reject);
    return Promise.resolve({ id: ID }).then(accept, reject);
  } } };
  const response = await POST(req, context);
  assert.equal(req.bodyUsed, false);
  return { status: response.status, body: await response.json() };
}
test("route calls production auth with req only and contains no body parsing or legacy hints", () => {
  const source = readFileSync(resolve(route), "utf8");
  assert.match(source, /const auth = await requireProductionAdmin\(req\);/);
  assert.doesNotMatch(source, /req\.json\(|\bbody\b|tenantSlug/);
});
for (const body of [undefined, "{", JSON.stringify({ tenantId: B, tenantSlug: "tenant-b" })]) {
  test(`body ${body} is ignored and all operations use authenticated tenant`, async () => {
    const result = await request(body);
    assert.deepEqual(result, { status: 200, body: { ok: true, status: { siiStatus: "ACCEPTED", responseSha256: "sha-test" } } });
    assert.deepEqual(state.events, ["auth:start", "auth:end", "params", "queryStatus", "intent", "rpc"]);
    assert.deepEqual(state.statusCalls, [{ tenantId: A, documentId: ID, actorId: "admin-a" }]);
    assert.equal(state.queries.length, 1);
    assert.equal(state.queries[0].table, "dte_payment_document_intents");
    assert.equal(state.queries[0].columns, "status");
    assert.deepEqual(state.queries[0].filters, [["tenant_id", A], ["production_document_id", ID]]);
    assert.deepEqual(state.rpcs, [{ name: "dte_reconcile_intent_status", args: { p_tenant_id: A, p_production_document_id: ID, p_status: "ACCEPTED", p_sii_status: "accepted", p_actor_id: "admin-a" } }]);
  });
}
for (const status of [401, 403, 400, 500]) {
  test(`auth rejection ${status} does not consume body, params or trigger effects`, async () => {
    state.access = { ok: false, status, error: "Authorization failed" };
    assert.deepEqual(await request("{"), { status, body: { ok: false, error: "Authorization failed" } });
    assert.deepEqual(state.events, ["auth:start", "auth:end"]);
    assert.equal(state.rpcs.length, 0);
    assert.equal(state.statusCalls.length, 0);
    assert.equal(state.queries.length, 0);
  });
}
for (const failure of ["auth", "params", "service", "intent:throw", "intent:error", "intent:missing", "rpc:throw", "rpc:error"]) {
  test(`${failure} preserves safeProductionApiError mapping`, async () => {
    state.failure = failure;
    const result = await request();
    const message = ["intent:error", "intent:missing", "rpc:error"].includes(failure) ? "DTE_INTENT_STATUS_RECONCILIATION_FAILED" : privateError.message;
    const expected = safeProductionApiError(new Error(message));
    assert.deepEqual(result, { status: expected.status, body: await expected.json() });
    assert.doesNotMatch(JSON.stringify(result), /private|details|hint/);
    if (!failure.startsWith("rpc:")) assert.equal(state.rpcs.length, 0);
  });
}
for (const status of ["ACCEPTED", "unknown"]) {
  test(`planner skips reconciliation for ${status}`, async () => {
    if (status === "ACCEPTED") state.intentStatus = status;
    else state.siiStatus = status;
    assert.equal((await request()).status, 200);
    assert.equal(state.queries.length, 1);
    assert.equal(state.rpcs.length, 0);
  });
}
