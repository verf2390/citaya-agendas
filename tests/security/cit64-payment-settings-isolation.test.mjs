import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { tenantCredentialUpdates } from "../../services/payments/payment-settings-credentials.ts";
import { tenantManualBankUpdates, evaluateTenantPaymentReadiness } from "../../services/payments/provider-readiness.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const state = {};
const privateError = { message: "private payment_methods_enabled webpay_api_key", details: "private tenant_payment_settings", hint: "Ejecuta migrations/FLEXIBLE_PAYMENTS_SCHEMA.sql en Supabase" };
const bank = { bankName: "Banco Test", bankAccountType: "Corriente", bankAccountNumber: "123456789", bankAccountHolder: "Empresa Test", bankRut: "12345678-5", bankEmail: "bank@example.test" };
const demoBank = { bankName: "Otro banco", bankAccountType: "Otro", bankAccountNumber: "DEMO-NO-TRANSFERIR", bankAccountHolder: "EMPRESA DEMO CITAYA", bankRut: "00.000.000-0", bankEmail: "demo@citaya.invalid" };
const credentials = { mercadopagoPublicKey: "public-key-test", mercadopagoAccessToken: "secret-mp-test", webpayCommerceCode: "commerce-test", webpayApiKey: "secret-webpay-test", khipuReceiverId: "receiver-test", khipuSecret: "short" };
const input = () => ({ paymentMode: "required", depositType: "percentage", depositValue: 25, paymentMethodsEnabled: ["mercadopago", "webpay", "khipu", "manual"], paymentCollectionMode: "deposit", webpayEnvironment: "integration", khipuEnvironment: "development", ...credentials, ...bank });
class Query {
  constructor(table) { this.table = table; this.filters = []; this.operation = "read"; }
  select(columns) { this.columns = columns; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  maybeSingle() { return this; }
  update(row) { this.operation = "update"; this.row = row; return this; }
  insert(row) { this.operation = "insert"; this.row = row; return this; }
  then(accept, reject) {
    return Promise.resolve().then(() => {
      state.queries.push(this);
      if (state.failure === `${this.operation}:throw`) throw new Error(privateError.message);
      if (state.failure === `${this.operation}:error`) return { data: null, error: privateError };
      if (this.operation === "insert") {
        state.rows.push(structuredClone(this.row));
        return { data: null, error: null };
      }
      const row = state.rows.find((row) => this.filters.every(([key, value]) => row[key] === value));
      if (row && this.operation === "update") Object.assign(row, this.row);
      return { data: row ? structuredClone(row) : null, error: null };
    }).then(accept, reject);
  }
}
// Real handlers, Zod schema, credential/bank validators and readiness.
// Host boundary, config loader and DB are mocked; no provider or remote DB calls.
globalThis.__cit64Payment = {
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
  async getTenantPaymentConfig(tenantId) {
    state.events.push("config");
    assert.equal(state.authorized, true);
    state.configCalls.push(tenantId);
    if (state.failure === "config") throw new Error(privateError.message);
    return state.config;
  },
  tenantCredentialUpdates(body) {
    state.events.push("credentials");
    assert.equal(state.authorized, true);
    if (state.failure === "credentials") throw new Error(privateError.message);
    return tenantCredentialUpdates(body);
  },
  tenantManualBankUpdates(body, options) {
    state.events.push("bank");
    assert.equal(state.authorized, true);
    state.bankOptions.push(options);
    if (state.failure === "bank") throw new Error(privateError.message);
    return tenantManualBankUpdates(body, options);
  },
  evaluateTenantPaymentReadiness(config) {
    state.events.push("readiness");
    return evaluateTenantPaymentReadiness(config);
  },
  supabaseAdmin: { from(table) {
    state.events.push("db");
    assert.equal(state.authorized, true);
    assert.equal(table, "tenant_payment_settings");
    return new Query(table);
  } },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = { "next/server": "next", "@/lib/supabaseAdmin": "db", "@/lib/api/requireTenantAdmin": "auth", "@/services/payments/payment-config": "config", "@/services/payments/payment-settings-credentials": "credentials", "@/services/payments/provider-readiness": "readiness" };
    if (map[specifier]) return { url: `cit64-payment:${map[specifier]}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "cit64-payment:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    const groups = { db: ["supabaseAdmin"], auth: ["requireHostTenantAdmin"], config: ["getTenantPaymentConfig"], credentials: ["tenantCredentialUpdates"], readiness: ["tenantManualBankUpdates", "evaluateTenantPaymentReadiness"] };
    const names = groups[url.replace("cit64-payment:", "")];
    if (names) return { format: "module", source: names.map((name) => `export const ${name} = globalThis.__cit64Payment.${name};`).join("\n"), shortCircuit: true };
    return nextLoad(url, context);
  },
});
const handlers = await import(pathToFileURL(resolve("app/api/admin/payment-settings/route.ts")).href);
test.beforeEach((t) => {
  Object.assign(state, { access: { ok: true, tenantId: A, operationalMode: "live" }, authorized: false, failure: null, events: [], configCalls: [], queries: [], bankOptions: [], rows: [{ tenant_id: A, marker: "own" }, { tenant_id: B, marker: "foreign" }], config: {
    settingsFound: true, paymentMethodsValid: true, enabled: true, mode: "required", depositType: "percentage", depositValue: 25, paymentMethodsEnabled: ["mercadopago", "webpay", "khipu", "manual"], collectionMode: "deposit", publicKey: credentials.mercadopagoPublicKey, accessToken: credentials.mercadopagoAccessToken, webpayCommerceCode: credentials.webpayCommerceCode, webpayApiKey: credentials.webpayApiKey, webpayEnvironment: "integration", khipuReceiverId: credentials.khipuReceiverId, khipuSecret: credentials.khipuSecret, khipuEnvironment: "development", ...bank,
  } });
  t.mock.method(console, "error", () => {});
});
async function request(method, { body = input(), query = "", malformed = false } = {}) {
  const req = new Request(`https://tenant-a.example.test/api/admin/payment-settings${query}`, { method, ...(method === "POST" ? { body: malformed ? "{" : JSON.stringify(body) } : {}) });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await handlers[method](req);
  return { status: response.status, body: await response.json() };
}
function assertNoInternals(result) {
  assert.doesNotMatch(JSON.stringify(result), /private|schemaHint|details|hint|tenant_payment_settings|payment_methods_enabled|webpay_api_key|migrations|\.sql|Supabase/);
}
for (const method of ["GET", "POST"]) {
  for (const status of [401, 403, 400, 500]) {
    test(`${method} auth ${status} precedes config, body, credentials, bank and DB`, async () => {
      state.access = { ok: false, status, error: status === 500 ? privateError.message : "Authorization failed" };
      const result = await request(method, { malformed: true });
      assert.equal(result.status, status);
      assertNoInternals(result);
      assert.deepEqual(state.events, ["auth:start", "auth:end"]);
      assert.equal(state.queries.length, 0);
      assert.equal(state.configCalls.length, 0);
    });
  }
  test(`${method} auth exception is generic`, async () => {
    state.failure = "auth";
    const result = await request(method);
    assert.equal(result.status, 500);
    assertNoInternals(result);
    assert.deepEqual(state.events, ["auth:start"]);
  });
}
for (const query of ["", `?tenantId=${B}`, "?tenantId=invalid"]) {
  test(`GET ignores query ${query} and retains readiness and masking`, async () => {
    const result = await request("GET", { query });
    assert.equal(result.status, 200);
    assert.deepEqual(state.events, ["auth:start", "auth:end", "config", "readiness"]);
    assert.deepEqual(state.configCalls, [A]);
    const settings = result.body.settings;
    assert.equal(settings.tenantId, A);
    assert.equal(settings.paymentProviderReady, true);
    for (const provider of ["mercadopago", "webpay", "khipu", "manual"]) assert.deepEqual(settings.paymentMethodReadiness[provider], { configured: true, enabled: true, ready: true });
    assert.equal(settings.mercadopagoPublicKeyPreview, "pub***est");
    assert.equal(settings.mercadopagoAccessTokenPreview, "sec***est");
    assert.equal(settings.webpayApiKeyPreview, "sec***est");
    assert.equal(settings.khipuSecretPreview, "******");
    for (const key of ["mercadopagoPublicKey", "mercadopagoAccessToken", "webpayApiKey", "khipuSecret"]) {
      assert.equal(settings[`${key}Configured`], true);
      assert.equal(JSON.stringify(result).includes(credentials[key]), false);
      assert.equal(Object.hasOwn(settings, key), false);
    }
    for (const [key, value] of Object.entries(bank)) assert.equal(settings[key], value);
    assertNoInternals(result);
  });
}
for (const existing of [true, false]) {
  for (const hint of [B, undefined, { invalid: true }]) {
    test(`POST ${existing ? "update" : "insert"} ignores body tenant ${JSON.stringify(hint)}`, async () => {
      if (!existing) state.rows = state.rows.filter((row) => row.tenant_id === B);
      const beforeB = structuredClone(state.rows.find((row) => row.tenant_id === B));
      const result = await request("POST", { body: { ...input(), tenantId: hint, tenant_id: B }, query: `?tenantId=${B}` });
      assert.deepEqual(result, { status: 200, body: { ok: true, settings: { tenantId: A, enabled: true, paymentMode: "required", depositType: "percentage", depositValue: 25, paymentMethodsEnabled: input().paymentMethodsEnabled, paymentCollectionMode: "deposit" } } });
      assert.deepEqual(state.events, ["auth:start", "auth:end", "json", "credentials", "bank", "db", "db"]);
      assert.equal(state.queries.length, 2);
      assert.deepEqual(state.queries[0].filters, [["tenant_id", A]]);
      const write = state.queries[1];
      assert.equal(write.operation, existing ? "update" : "insert");
      if (existing) {
        assert.deepEqual(write.filters, [["tenant_id", A]]);
        assert.ok(Number.isFinite(Date.parse(write.row.updated_at)));
      } else assert.equal(write.row.tenant_id, A);
      const { updated_at, tenant_id, ...payload } = write.row;
      assert.deepEqual(payload, { active: true, payment_mode: "required", deposit_type: "percentage", deposit_value: 25, payment_methods_enabled: input().paymentMethodsEnabled, payment_collection_mode: "deposit", webpay_environment: "integration", khipu_environment: "development", ...tenantCredentialUpdates(input()).updates, ...tenantManualBankUpdates(input()).updates });
      assert.deepEqual(state.rows.find((row) => row.tenant_id === B), beforeB);
      assert.deepEqual(state.bankOptions, [{ allowDemoPlaceholder: false }]);
    });
  }
}
for (const method of ["GET", "POST"]) {
  test(`${method} demo bank placeholders remain unchanged`, async () => {
    state.access.operationalMode = "demo";
    const result = await request(method, { body: { ...input(), ...demoBank } });
    assert.equal(result.status, 200);
    if (method === "GET") {
      for (const [key, value] of Object.entries(demoBank)) assert.equal(result.body.settings[key], value);
    } else {
      assert.deepEqual(state.bankOptions, [{ allowDemoPlaceholder: true }]);
      const expected = tenantManualBankUpdates(demoBank, { allowDemoPlaceholder: true }).updates;
      for (const [key, value] of Object.entries(expected)) assert.equal(state.queries[1].row[key], value);
    }
  });
}
for (const stage of ["config", "credentials", "bank", "read:error", "read:throw", "update:error", "update:throw", "insert:error", "insert:throw"]) {
  test(`${stage} errors are generic without schema instructions`, async () => {
    state.failure = stage;
    if (stage.startsWith("insert:")) state.rows = state.rows.filter((row) => row.tenant_id === B);
    const result = await request(stage === "config" ? "GET" : "POST");
    assert.equal(result.status, 500);
    assert.deepEqual(Object.keys(result.body).sort(), ["error", "ok"]);
    assertNoInternals(result);
  });
}
for (const body of [
  { paymentMode: "invalid" },
  { paymentMethodsEnabled: [] },
  { paymentCollectionMode: "invalid" },
  { webpayEnvironment: "invalid" },
  { khipuEnvironment: "invalid" },
  { depositType: "invalid" },
  { depositValue: 0 },
  { depositValue: 101 },
  { mercadopagoAccessToken: 123 },
  { bankEmail: "invalid" },
]) {
  test(`POST retains validation for ${JSON.stringify(body)}`, async () => {
    const result = await request("POST", { body: { ...input(), ...body } });
    assert.equal(result.status, 400);
    assertNoInternals(result);
    assert.deepEqual(state.events.slice(0, 3), ["auth:start", "auth:end", "json"]);
    assert.equal(state.queries.length, 0);
  });
}
test("POST malformed JSON validates after auth", async () => {
  assert.equal((await request("POST", { malformed: true })).status, 400);
  assert.deepEqual(state.events, ["auth:start", "auth:end", "json"]);
});
test("POST omitted or empty credentials retain existing secrets", async () => {
  state.rows[0].mercadopago_access_token = "previous-secret";
  assert.equal((await request("POST", { body: { paymentMode: "none", mercadopagoAccessToken: " " } })).status, 200);
  assert.equal(state.rows[0].mercadopago_access_token, "previous-secret");
  assert.equal(state.queries[1].row.active, false);
  assert.equal(Object.hasOwn(state.queries[1].row, "deposit_type"), false);
  assert.equal(Object.hasOwn(state.queries[1].row, "mercadopago_access_token"), false);
});
test("POST fixed deposit and explicit deposit clearing remain supported", async () => {
  const fixed = await request("POST", { body: { paymentMode: "optional", depositType: "fixed", depositValue: "1500" } });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.settings.depositValue, 1500);
  const cleared = await request("POST", { body: { paymentMode: "optional", depositType: null } });
  assert.equal(cleared.status, 200);
  assert.equal(state.rows[0].deposit_type, null);
  assert.equal(state.rows[0].deposit_value, null);
});
