import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const SERVICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_INACTIVE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SERVICE_INCOMPLETE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SERVICE_DEMO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const state = {
  tenants: [],
  services: [],
  errors: {},
  queries: [],
};

function resetState() {
  state.tenants = [
    { id: TENANT_A, slug: "tenant-a", lifecycle_status: "active", operational_mode: "live" },
    { id: TENANT_B, slug: "tenant-b", lifecycle_status: "active", operational_mode: "live" },
    { id: "33333333-3333-4333-8333-333333333333", slug: "inactive", lifecycle_status: "archived", operational_mode: "live" },
    { id: "44444444-4444-4444-8444-444444444444", slug: "unclassified", lifecycle_status: "active", operational_mode: "unclassified" },
    { id: "55555555-5555-4555-8555-555555555555", slug: "demo", lifecycle_status: "active", operational_mode: "demo" },
  ];
  state.services = [
    { id: SERVICE_A, tenant_id: TENANT_A, name: "Service A", duration_min: 30, is_active: true, price: 1000, currency: "CLP", payment_configuration_complete: true },
    { id: SERVICE_B, tenant_id: TENANT_B, name: "Service B", duration_min: 45, is_active: true, price: 2000, currency: "CLP", payment_configuration_complete: true },
    { id: SERVICE_INACTIVE, tenant_id: TENANT_A, name: "Inactive", duration_min: 30, is_active: false, price: 1000, currency: "CLP", payment_configuration_complete: true },
    { id: SERVICE_INCOMPLETE, tenant_id: TENANT_A, name: "Incomplete", duration_min: 30, is_active: true, price: 1000, currency: "CLP", payment_configuration_complete: false },
    { id: SERVICE_DEMO, tenant_id: "55555555-5555-4555-8555-555555555555", name: "Demo service", duration_min: 30, is_active: true, price: 0, currency: "CLP", payment_configuration_complete: false },
  ];
  state.errors = {};
  state.queries = [];
}

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
  }

  select(columns) {
    this.columns = columns;
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  async maybeSingle() {
    state.queries.push({ table: this.table, columns: this.columns, filters: [...this.filters] });
    const error = state.errors[this.table];
    if (error) return { data: null, error };
    const rows = state[this.table] ?? [];
    const data = rows.find((row) => this.filters.every(([column, value]) => row[column] === value)) ?? null;
    return { data, error: null };
  }
}

globalThis.__cit64SupabaseAdmin = {
  from(table) {
    return new Query(table);
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return { url: "cit64:next-server", shortCircuit: true };
    }
    if (specifier === "@/lib/supabaseAdmin") {
      return { url: "cit64:supabase-admin", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolve(specifier.slice(2))).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "cit64:next-server") {
      return {
        format: "module",
        source: "export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }",
        shortCircuit: true,
      };
    }
    if (url === "cit64:supabase-admin") {
      return {
        format: "module",
        source: "export const supabaseAdmin = globalThis.__cit64SupabaseAdmin;",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { GET } = await import(
  pathToFileURL(resolve("app/api/services/by-tenant/by-id/route.ts")).href
);

async function request(query = "") {
  const response = await GET(new Request(`https://citaya.test/api/services/by-tenant/by-id${query}`));
  return { response, body: await response.json() };
}

test.beforeEach(resetState);

test("CIT-64 service by-id requires valid id and tenant", async () => {
  for (const query of ["", `?id=${SERVICE_A}`, "?tenant=tenant-a", "?id=not-a-uuid&tenant=tenant-a", `?id=${SERVICE_A}&tenant=INVALID_SLUG`]) {
    const { response } = await request(query);
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("CIT-64 service by-id hides missing, inactive and non-operational tenants", async () => {
  for (const tenant of ["missing", "inactive", "unclassified"]) {
    const { response, body } = await request(`?id=${SERVICE_A}&tenant=${tenant}`);
    assert.equal(response.status, 404, tenant);
    assert.deepEqual(body, { ok: false, error: "Service not found" });
  }
});

test("CIT-64 service by-id returns only a tenant-owned public service shape", async () => {
  const { response, body } = await request(`?id=${SERVICE_A}&tenant=tenant-a`);
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    service: {
      id: SERVICE_A,
      name: "Service A",
      duration_minutes: 30,
      price: 1000,
      currency: "CLP",
      is_active: true,
    },
  });
  assert.equal("tenant_id" in body.service, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("CIT-64 service by-id rejects a foreign tenant service id", async () => {
  const { response } = await request(`?id=${SERVICE_B}&tenant=tenant-a`);
  assert.equal(response.status, 404);
  const serviceQuery = state.queries.find(({ table }) => table === "services");
  assert.deepEqual(serviceQuery.filters, [
    ["id", SERVICE_B],
    ["tenant_id", TENANT_A],
    ["is_active", true],
    ["payment_configuration_complete", true],
  ]);
});

test("CIT-64 service by-id rejects inactive and incomplete live services", async () => {
  for (const id of [SERVICE_INACTIVE, SERVICE_INCOMPLETE]) {
    const { response } = await request(`?id=${id}&tenant=tenant-a`);
    assert.equal(response.status, 404, id);
  }
});

test("CIT-64 service by-id permits an active incomplete service only in demo", async () => {
  const { response, body } = await request(`?id=${SERVICE_DEMO}&tenant=demo`);
  assert.equal(response.status, 200);
  assert.equal(body.service.id, SERVICE_DEMO);
  const serviceQuery = state.queries.find(({ table }) => table === "services");
  assert.equal(
    serviceQuery.filters.some(([column]) => column === "payment_configuration_complete"),
    false,
  );
});

test("CIT-64 service by-id never leaks Supabase error fields", async () => {
  state.errors.services = {
    message: "relation services secret failure",
    details: "private database details",
    hint: "internal schema hint",
  };
  const { response, body } = await request(`?id=${SERVICE_A}&tenant=tenant-a`);
  assert.equal(response.status, 500);
  assert.deepEqual(body, { ok: false, error: "Error interno" });
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /secret failure|private database|schema hint/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
