import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const privateError = {
  message: "private tenant_billing_settings default_document_type provider_status",
  details: "private details",
  hint: "Execute migrations/BILLING_SETTINGS_SCHEMA.sql",
};
const state = {};
class Query {
  constructor(table) { this.table = table; this.filters = []; }
  select(columns) { this.columns = columns; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  upsert(row, options) { this.row = row; this.options = options; return this; }
  maybeSingle() { return this; }
  single() { return this; }
  then(accept, reject) {
    return Promise.resolve().then(() => {
      state.queries.push(this);
      if (state.failure === "db:throw") throw new Error(privateError.message);
      if (state.failure === "db:error") return { data: null, error: privateError };
      if (this.row) {
        const index = state.rows.findIndex((row) => row.tenant_id === this.row.tenant_id);
        if (index < 0) state.rows.push(structuredClone(this.row));
        else state.rows[index] = { ...state.rows[index], ...this.row };
        return { data: structuredClone(this.row), error: null };
      }
      const row = state.rows.find((row) => this.filters.every(([key, value]) => row[key] === value));
      return { data: row ? structuredClone(row) : null, error: null };
    }).then(accept, reject);
  }
}
// Real GET/PUT and Zod schema; mocked hostname boundary and database.
// The helper's internal hostname lookup is unchanged and outside this test.
globalThis.__cit64Billing = {
  async requireHostTenantAdmin(...args) {
    assert.equal(args.length, 1);
    assert.ok(args[0] instanceof Request);
    assert.equal(new URL(args[0].url).hostname, "tenant-a.example.test");
    state.events.push("auth:start");
    await Promise.resolve();
    if (state.failure === "auth:throw") throw new Error(privateError.message);
    state.events.push("auth:end");
    state.authorized = state.access.ok;
    return state.access;
  },
  supabaseAdmin: { from(table) {
    assert.equal(state.authorized, true, "no route DB access before auth succeeds");
    assert.equal(table, "tenant_billing_settings");
    state.events.push("db");
    return new Query(table);
  } },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = { "next/server": "next", "@/lib/supabaseAdmin": "supabaseAdmin", "@/lib/api/requireTenantAdmin": "requireHostTenantAdmin" };
    if (mocks[specifier]) return { url: `cit64-billing:${mocks[specifier]}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "cit64-billing:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    if (url.startsWith("cit64-billing:")) {
      const name = url.split(":")[1];
      return { format: "module", source: `export const ${name} = globalThis.__cit64Billing.${name};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const handlers = await import(pathToFileURL(resolve("app/api/admin/billing-settings/route.ts")).href);
const defaults = {
  tenantId: A, legalName: "", taxId: "", businessActivity: "", taxAddress: "", taxCommune: "", taxCity: "", taxEmail: "", taxPhone: "",
  defaultDocumentType: "boleta", provider: "none", providerStatus: "not_configured", autoIssueOnPaid: false, allowInvoiceRequest: true,
};
const fullSettings = {
  legalName: "Empresa A", taxId: "12.345.678-5", businessActivity: "Servicios", taxAddress: "Calle 1", taxCommune: "Santiago", taxCity: "Santiago", taxEmail: "billing@example.test", taxPhone: "+56912345678",
  defaultDocumentType: "factura", provider: "api_provider", providerStatus: "connected", autoIssueOnPaid: true, allowInvoiceRequest: false,
};
const columns = {
  legalName: "legal_name", taxId: "tax_id", businessActivity: "business_activity", taxAddress: "tax_address", taxCommune: "tax_commune", taxCity: "tax_city", taxEmail: "tax_email", taxPhone: "tax_phone", defaultDocumentType: "default_document_type", provider: "provider", providerStatus: "provider_status", autoIssueOnPaid: "auto_issue_on_paid", allowInvoiceRequest: "allow_invoice_request",
};
const fullRow = Object.fromEntries(Object.entries(fullSettings).map(([key, value]) => [columns[key], value]));
test.beforeEach((t) => {
  Object.assign(state, { access: { ok: true, tenantId: A }, authorized: false, events: [], queries: [], failure: null, rows: [{ tenant_id: A, ...fullRow }, { tenant_id: B, legal_name: "Empresa B" }] });
  t.mock.method(console, "error", () => {});
});
async function request(method, { body = {}, query = "", malformed = false } = {}) {
  const req = new Request(`https://tenant-a.example.test/api/admin/billing-settings${query}`, { method, ...(method === "PUT" ? { body: malformed ? "{" : JSON.stringify(body) } : {}) });
  const json = req.json.bind(req);
  req.json = () => { state.events.push("json"); return json(); };
  const response = await handlers[method](req);
  return { status: response.status, body: await response.json() };
}
const publicError = (method) => method === "GET" ? "Error cargando facturación" : "Error guardando facturación";
for (const method of ["GET", "PUT"]) {
  for (const status of [401, 403, 400, 500]) {
    test(`${method}: auth ${status} precedes body and DB`, async () => {
      state.access = { ok: false, status, error: status === 500 ? privateError.message : "Authorization failed" };
      const before = structuredClone(state.rows);
      assert.deepEqual(await request(method, { malformed: true }), { status, body: { ok: false, error: status === 500 ? publicError(method) : "Authorization failed" } });
      assert.deepEqual(state.events, ["auth:start", "auth:end"]);
      assert.equal(state.queries.length, 0);
      assert.deepEqual(state.rows, before);
    });
  }
  for (const failure of ["auth:throw", "db:error", "db:throw"]) {
    test(`${method}: ${failure} returns only generic public error`, async () => {
      state.failure = failure;
      const result = await request(method);
      assert.deepEqual(result, { status: 500, body: { ok: false, error: publicError(method) } });
      assert.doesNotMatch(JSON.stringify(result), /private|schemaHint|details|hint|tenant_billing_settings|default_document_type|provider_status|migrations|\.sql/);
      if (failure === "auth:throw") assert.deepEqual(state.events, ["auth:start"]);
    });
  }
}
for (const query of ["", `?tenantId=${B}&tenantSlug=tenant-b`, "?tenantId=invalid&tenantSlug=invalid"]) {
  test(`GET ignores query ${query} and reads host tenant`, async () => {
    const result = await request("GET", { query });
    assert.deepEqual(result, { status: 200, body: { ok: true, settings: { tenantId: A, ...fullSettings } } });
    assert.deepEqual(state.events, ["auth:start", "auth:end", "db"]);
    assert.equal(state.queries.length, 1);
    assert.deepEqual(state.queries[0].filters, [["tenant_id", A]]);
    assert.equal(state.queries[0].row, undefined);
  });
}
test("GET missing row returns existing defaults with authenticated tenant", async () => {
  state.rows = state.rows.filter((row) => row.tenant_id === B);
  assert.deepEqual(await request("GET"), { status: 200, body: { ok: true, settings: defaults } });
});
for (const hints of [{}, { tenantId: B, tenantSlug: "tenant-b" }, { tenantId: { invalid: true }, tenantSlug: 42 }]) {
  test(`PUT ignores legacy hints ${JSON.stringify(hints)} and preserves all settings`, async () => {
    const beforeB = structuredClone(state.rows[1]);
    const body = Object.fromEntries(Object.entries(fullSettings).map(([key, value]) => [key, typeof value === "string" && !["defaultDocumentType", "provider", "providerStatus"].includes(key) ? ` ${value} ` : value]));
    const result = await request("PUT", { body: { ...body, ...hints, tenant_id: B }, query: `?tenantId=${B}&tenantSlug=tenant-b` });
    assert.deepEqual(result, { status: 200, body: { ok: true, settings: { tenantId: A, ...fullSettings } } });
    assert.deepEqual(state.events, ["auth:start", "auth:end", "json", "db"]);
    assert.equal(state.queries.length, 1);
    const q = state.queries[0];
    assert.deepEqual(q.options, { onConflict: "tenant_id" });
    const { updated_at, ...payload } = q.row;
    assert.ok(Number.isFinite(Date.parse(updated_at)));
    assert.deepEqual(payload, { tenant_id: A, ...fullRow });
    assert.deepEqual(state.rows[1], beforeB);
  });
}
test("PUT empty settings inserts tenant A with existing defaults", async () => {
  state.rows = state.rows.filter((row) => row.tenant_id === B);
  const beforeB = structuredClone(state.rows[0]);
  assert.deepEqual(await request("PUT"), { status: 200, body: { ok: true, settings: defaults } });
  assert.equal(state.rows.length, 2);
  assert.equal(state.rows[1].tenant_id, A);
  assert.equal(state.rows[1].tax_id, null);
  assert.equal(state.rows[1].tax_email, null);
  assert.deepEqual(state.rows[0], beforeB);
});
for (const input of [
  { provider: "manual_sii" },
  { providerStatus: "pending" },
  { autoIssueOnPaid: true },
]) {
  test(`billingEnabled still requires taxId for ${JSON.stringify(input)}`, async () => {
    const result = await request("PUT", { body: input });
    assert.deepEqual(result, { status: 400, body: { ok: false, error: "RUT requerido para activar facturacion." } });
    assert.deepEqual(state.events, ["auth:start", "auth:end", "json"]);
    assert.equal(state.queries.length, 0);
  });
}
for (const options of [
  { body: { taxEmail: "invalid" } },
  { body: { provider: "invalid" } },
  { body: { providerStatus: "invalid" } },
  { body: { defaultDocumentType: "invalid" } },
  { body: { autoIssueOnPaid: "true" } },
  { body: { allowInvoiceRequest: "false" } },
  { malformed: true },
]) {
  test(`PUT validation preserved for ${JSON.stringify(options)}`, async () => {
    const result = await request("PUT", options);
    assert.equal(result.status, 400);
    assert.deepEqual(Object.keys(result.body).sort(), ["error", "ok"]);
    assert.equal(state.queries.length, 0);
    assert.deepEqual(state.events, ["auth:start", "auth:end", "json"]);
  });
}
test("optional tax fields still accept null and whitespace", async () => {
  const result = await request("PUT", { body: { taxId: "  ", taxEmail: null, legalName: null, taxPhone: "  " } });
  assert.deepEqual(result, { status: 200, body: { ok: true, settings: defaults } });
  for (const field of ["tax_id", "tax_email", "legal_name", "tax_phone"]) assert.equal(state.queries[0].row[field], null);
});
