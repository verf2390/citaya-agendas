import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);
const state = { queries: [], tenant: null, dbError: null };

class Query {
  constructor(table) { this.table = table; this.filters = []; }
  select(columns) { this.columns = columns; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  maybeSingle() {
    state.queries.push({ table: this.table, columns: this.columns, filters: this.filters });
    return Promise.resolve({ data: state.tenant, error: state.dbError });
  }
}

globalThis.__citayaM2MAuth = {
  supabaseAdmin: {
    from(table) {
      assert.equal(table, "tenants");
      return new Query(table);
    },
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabaseAdmin") {
      return { url: "citaya-m2m:supabase", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      const file = relative.endsWith(".mjs") ? relative : relative + ".ts";
      return { url: pathToFileURL(resolve(file)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "citaya-m2m:supabase") {
      return {
        format: "module",
        source: "export const supabaseAdmin = globalThis.__citayaM2MAuth.supabaseAdmin;",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { requireM2M } = await import(pathToFileURL(resolve("lib/api/requireM2M.ts")).href);

function req(tenantId, secret) {
  const headers = new Headers();
  if (tenantId) headers.set("x-citaya-tenant-id", tenantId);
  if (secret) headers.set("authorization", "Bearer " + secret);
  return new Request("https://app.citaya.online/api/integrations/ai", { headers });
}

test.beforeEach((t) => {
  const previous = process.env.M2M_CREDENTIALS_JSON;
  t.after(() => {
    if (previous === undefined) delete process.env.M2M_CREDENTIALS_JSON;
    else process.env.M2M_CREDENTIALS_JSON = previous;
  });
  process.env.M2M_CREDENTIALS_JSON = JSON.stringify({ [A]: SECRET_A, [B]: SECRET_B });
  state.queries = [];
  state.dbError = null;
  state.tenant = { id: A, slug: "tenant-a", lifecycle_status: "active", operational_mode: "live" };
});

test("M2M binds the authenticated credential to exactly one tenant", async () => {
  const result = await requireM2M(req(A, SECRET_A));
  assert.deepEqual(result, {
    ok: true,
    tenantId: A,
    tenantSlug: "tenant-a",
    serviceId: "n8n",
    authMode: "m2m",
    operationalMode: "live",
  });
  assert.deepEqual(state.queries[0].filters, [["id", A]]);
});

test("M2M rejects a secret belonging to another tenant before DB access", async () => {
  const result = await requireM2M(req(A, SECRET_B));
  assert.deepEqual(result, { ok: false, error: "Unauthorized", status: 401 });
  assert.equal(state.queries.length, 0);
});

test("M2M rejects missing or malformed identity before DB access", async () => {
  for (const request of [req("", SECRET_A), req(A, ""), req("not-a-uuid", SECRET_A)]) {
    const result = await requireM2M(request);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  }
  assert.equal(state.queries.length, 0);
});

test("M2M fails closed when credential configuration is malformed", async () => {
  process.env.M2M_CREDENTIALS_JSON = "{bad-json";
  const result = await requireM2M(req(A, SECRET_A));
  assert.deepEqual(result, {
    ok: false,
    error: "M2M authentication unavailable",
    status: 500,
  });
  assert.equal(state.queries.length, 0);
});

test("M2M rejects weak configured secrets instead of accepting them", async () => {
  process.env.M2M_CREDENTIALS_JSON = JSON.stringify({ [A]: "short" });
  const result = await requireM2M(req(A, "short"));
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(state.queries.length, 0);
});

test("M2M blocks archived, suspended and unclassified tenants", async () => {
  for (const tenant of [
    { id: A, slug: "tenant-a", lifecycle_status: "archived", operational_mode: "live" },
    { id: A, slug: "tenant-a", lifecycle_status: "suspended", operational_mode: "live" },
    { id: A, slug: "tenant-a", lifecycle_status: "active", operational_mode: "unclassified" },
  ]) {
    state.tenant = tenant;
    const result = await requireM2M(req(A, SECRET_A));
    assert.deepEqual(result, { ok: false, error: "Forbidden", status: 403 });
  }
});

test("M2M accepts active demo and internal tenants at the authentication boundary", async () => {
  for (const mode of ["demo", "internal"]) {
    state.tenant = { id: A, slug: "tenant-a", lifecycle_status: "active", operational_mode: mode };
    const result = await requireM2M(req(A, SECRET_A));
    assert.equal(result.ok, true);
    assert.equal(result.operationalMode, mode);
  }
});

test("M2M returns generic DB failure without exposing provider details", async () => {
  state.dbError = { message: "private postgres detail", hint: "secret" };
  const result = await requireM2M(req(A, SECRET_A));
  assert.deepEqual(result, {
    ok: false,
    error: "M2M tenant validation unavailable",
    status: 500,
  });
});
