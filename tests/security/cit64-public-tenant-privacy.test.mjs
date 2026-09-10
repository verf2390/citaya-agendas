import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { resolveTenantOperationalCapabilities } from "../../lib/tenant/operational-mode.mjs";

const migration = readFileSync("migrations/202609080001_cit64_public_tenant_privacy_hardening.sql", "utf8").replace(/--[^\n]*/g, "");
const historical = readFileSync("migrations/202607230001_security_hardening.sql", "utf8");
const allowed = ["id", "slug", "name", "logo_url", "city", "description", "show_address", "show_phone"];
const grantColumns = (sql) => [...sql.matchAll(/grant select\s*\(([^)]+)\)\s*on public\.tenants to anon\s*;/gi)].flatMap((match) => match[1].split(",").map((value) => value.trim()));
test("[structural SQL, not executed] new migration removes temporary policy and preserves public metadata policy", () => {
  assert.match(migration, /drop policy if exists temp_allow_select_for_subdomain on public\.tenants;/);
  assert.match(historical, /create policy public_tenant_read on public\.tenants for select to anon using \(true\)/);
  assert.doesNotMatch(migration, /(?:drop|alter|create) policy public_tenant_read/);
  assert.doesNotMatch(migration, /\b(?:authenticated|service_role)\b/);
  assert.match(migration, /^\s*begin;/);
  assert.match(migration, /commit;\s*$/);
});
test("[structural SQL, not executed] table AND all column grants are revoked before explicit metadata grant", () => {
  assert.match(migration, /revoke select on public\.tenants from anon;/);
  assert.match(migration, /for tenant_column in\s+select attname\s+from pg_catalog\.pg_attribute\s+where attrelid = 'public\.tenants'::regclass\s+and attnum > 0\s+and not attisdropped\s+loop/);
  assert.match(migration, /execute format\('revoke select \(%I\) on public\.tenants from anon', tenant_column\.attname\);/);
  assert.ok(migration.indexOf("$$;") < migration.indexOf("grant select"));
  assert.deepEqual(grantColumns(migration), allowed);
  assert.ok(grantColumns(historical).includes("address"));
  assert.ok(grantColumns(historical).includes("phone_display"));
  for (const field of ["address", "phone_display"]) assert.equal(grantColumns(migration).includes(field), false);
  assert.equal([...migration.matchAll(/\bgrant\b/gi)].length, 1, "no broad or additional grants");
});

const ID = "11111111-1111-4111-8111-111111111111";
const hiddenAddress = "PRIVATE STREET 123";
const hiddenPhone = "+56987654321";
const state = {};
class Query {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  async maybeSingle() {
    state.queries.push(this);
    if (this.table === "tenants") {
      if (state.error) return { data: null, error: { message: "private database error" } };
      const matches = state.tenant && this.filters.every(([key, value]) => state.tenant[key] === value);
      return { data: matches ? structuredClone(state.tenant) : null, error: null };
    }
    assert.ok(this.filters.some(([key, value]) => key === "tenant_id" && value === ID));
    const results = {
      tenant_operational_features: {
        tax_document_mode: state.features.tax_document_mode,
        payments_enabled: state.features.payments_enabled,
        dte_enabled: state.features.dte_enabled,
      },
      dte_tenant_document_capabilities: { customer_selection_enabled: true, issuance_enabled: true, certification_status: "production_authorized" },
      dte_sii_authorization_evidence: { authorized_types: [33] },
      dte_legal_activation: { status: "active" },
    };
    assert.ok(this.table in results);
    return { data: results[this.table], error: null };
  }
}
globalThis.__cit64PublicTenant = {
  supabaseAdmin: {
    from(table) { return new Query(table); },
    async rpc(name, args) {
      state.rpcs.push({ name, args });
      if (name === "resolve_tenant_operational_capabilities") {
        return {
          data: resolveTenantOperationalCapabilities({
            lifecycleStatus: state.tenant?.lifecycle_status ?? "active",
            operationalMode: state.tenant?.operational_mode ?? "unclassified",
          }),
          error: null,
        };
      }
      if (name === "dte_activation_gate_report") {
        return { data: { ready: true }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  },
  async getTenantPaymentConfig(tenantId) {
    state.payments.push(tenantId);
    return { enabled: true, mode: "required", paymentMethodsEnabled: ["manual"], collectionMode: "deposit", depositType: "percentage", depositValue: 25 };
  },
  async loadTenantOperationalContext(tenantId) {
    const capabilities = resolveTenantOperationalCapabilities({
      lifecycleStatus: state.tenant?.lifecycle_status ?? "active",
      operationalMode: state.tenant?.operational_mode ?? "unclassified",
    });
    return {
      tenantId,
      tenantSlug: state.tenant?.slug ?? "",
      lifecycleStatus: capabilities.lifecycleStatus,
      operationalMode: capabilities.operationalMode,
      taxDocumentMode: state.features.tax_document_mode,
      paymentsEnabled: state.features.payments_enabled,
      dteEnabled: state.features.dte_enabled,
      capabilities,
    };
  },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = { "next/server": "next", "@/lib/supabaseAdmin": "supabaseAdmin", "@/services/payments/payment-config": "getTenantPaymentConfig" };
    if (map[specifier]) return { url: `cit64-public-tenant:${map[specifier]}`, shortCircuit: true };
    if (specifier === "@/lib/tenant/operational-mode.mjs") return { url: pathToFileURL(resolve("lib/tenant/operational-mode.mjs")).href, shortCircuit: true };
    if (specifier === "@/lib/tenant/operational-server") return { url: "cit64-public-tenant:loadTenantOperationalContext", shortCircuit: true };
    if (specifier === "@/lib/tenant/operational-types") return { url: pathToFileURL(resolve("lib/tenant/operational-types.ts")).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "cit64-public-tenant:next") return { format: "module", source: "export const NextResponse = Response;", shortCircuit: true };
    if (url.startsWith("cit64-public-tenant:")) {
      const name = url.split(":")[1];
      return { format: "module", source: `export const ${name} = globalThis.__cit64PublicTenant.${name};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { GET } = await import(pathToFileURL(resolve("app/api/tenants/by-slug/route.ts")).href);
test.beforeEach(() => {
  Object.assign(state, {
    queries: [],
    payments: [],
    rpcs: [],
    error: false,
    features: {
      tax_document_mode: "citaya_dte",
      payments_enabled: true,
      dte_enabled: true,
    },
    tenant: { id: ID, slug: "tenant-a", name: "Tenant A", min_lead_time_min: 30, phone_display: hiddenPhone, address: hiddenAddress, city: "Santiago", logo_url: null, description: "Public description", show_address_home: false, show_phone_home: false, show_address_after_booking: true, show_phone_after_booking: true, lifecycle_status: "active", operational_mode: "live" },
  });
});
async function request(query = "?slug=tenant-a") {
  const response = await GET(new Request(`https://tenant-a.example.test/api/tenants/by-slug${query}`));
  return { status: response.status, body: await response.json() };
}
for (const flag of [false, null, undefined, "true"]) {
  test(`home flags ${flag} cannot disclose service-role contact fields`, async () => {
    state.tenant.show_address_home = flag;
    state.tenant.show_phone_home = flag;
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.body.tenant.address, null);
    assert.equal(result.body.tenant.phone_display, null);
    assert.equal(result.body.tenant.address_display, "Santiago", "city remains public discovery metadata");
    assert.equal(JSON.stringify(result).includes(hiddenAddress), false);
    assert.equal(JSON.stringify(result).includes(hiddenPhone), false);
    assert.equal(state.tenant.address, hiddenAddress);
    assert.equal(state.tenant.phone_display, hiddenPhone);
  });
}
for (const [address, phone] of [[true, true], [true, false], [false, true]]) {
  test(`home flags independently allow address=${address}, phone=${phone}`, async () => {
    state.tenant.show_address_home = address;
    state.tenant.show_phone_home = phone;
    const { body } = await request();
    assert.equal(body.tenant.address, address ? hiddenAddress : null);
    assert.equal(body.tenant.phone_display, phone ? hiddenPhone : null);
    assert.equal(body.tenant.address_display, address ? `${hiddenAddress} · Santiago` : "Santiago");
  });
}
test("slug resolution, live capabilities, payment and DTE readiness remain tenant scoped", async () => {
  const { status, body } = await request();
  assert.equal(status, 200);
  assert.equal(body.tenant.id, ID);
  assert.equal(body.tenant.slug, "tenant-a");
  assert.equal(body.tenant.min_lead_time_min, 30);
  assert.deepEqual(state.queries[0].filters, [["slug", "tenant-a"], ["lifecycle_status", "active"]]);
  assert.deepEqual(body.tenant.operational_capabilities, resolveTenantOperationalCapabilities({ lifecycleStatus: "active", operationalMode: "live" }));
  assert.equal(body.tenant.payment_enabled, true);
  assert.equal(body.tenant.payment_mode, "required");
  assert.equal(body.tenant.deposit_value, 25);
  assert.equal(body.tenant.invoice_document_selection_enabled, true);
  assert.equal(body.tenant.boleta_document_selection_enabled, true);
  assert.deepEqual(state.payments, [ID]);
  const dteGateCall = state.rpcs.find((call) => call.name === "dte_activation_gate_report");
  assert.ok(dteGateCall);
  assert.equal(dteGateCall.args.p_tenant_id, ID);
  assert.deepEqual(
    state.rpcs.map((call) => call.name),
    ["dte_activation_gate_report"],
  );
});
test("demo keeps public resolution and suppresses payment/DTE effects", async () => {
  state.tenant.operational_mode = "demo";
  const { status, body } = await request();
  assert.equal(status, 200);
  assert.equal(body.tenant.demo_document_selection_enabled, true);
  assert.equal(body.tenant.payment_enabled, false);
  assert.equal(body.tenant.address, null);
  assert.equal(body.tenant.phone_display, null);
  assert.deepEqual(state.payments, []);
  assert.deepEqual(state.rpcs, []);
  assert.equal(state.queries.length, 1);
  assert.equal(
    state.queries.some((query) => query.table.startsWith("dte_")),
    false,
  );
});
for (const mode of ["missing", "archived"]) {
  test(`${mode} tenant still returns 404`, async () => {
    if (mode === "missing") state.tenant = null;
    else if (mode === "archived") state.tenant.lifecycle_status = "archived";
    else state.tenant.operational_mode = mode;
    assert.equal((await request()).status, 404);
    assert.equal(state.payments.length, 0);
  });
}
test("missing slug and DB failure keep generic responses", async () => {
  assert.equal((await request("")).status, 400);
  assert.equal(state.queries.length, 0);
  state.error = true;
  const result = await request();
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("unclassified keeps informational discovery with booking/payment capabilities blocked", async () => {
  state.tenant.operational_mode = "unclassified";
  const { status, body } = await request();
  assert.equal(status, 200);
  assert.equal(body.tenant.operational_capabilities.informationalPage, true);
  assert.equal(body.tenant.operational_capabilities.createAppointment, false);
  assert.equal(body.tenant.payment_enabled, false);
  assert.equal(body.tenant.address, null);
  assert.equal(body.tenant.phone_display, null);
});
