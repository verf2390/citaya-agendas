import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const state = { queries: [] };

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
  }
  select() { return this; }
  eq(key, value) { this.filters.push(["eq", key, value]); return this; }
  gte(key, value) { this.filters.push(["gte", key, value]); return this; }
  gt(key, value) { this.filters.push(["gt", key, value]); return this; }
  lt(key, value) { this.filters.push(["lt", key, value]); return this; }
  lte(key, value) { this.filters.push(["lte", key, value]); return this; }
  in(key, value) { this.filters.push(["in", key, value]); return this; }
  or(value) { this.filters.push(["or", value]); return this; }
  order() { return this; }
  limit() { return this; }
  then(resolve, reject) {
    state.queries.push(this);
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  }
}

globalThis.__citayaAIRepository = {
  supabaseAdmin: {
    from(table) {
      return new Query(table);
    },
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabaseAdmin") {
      return { url: "citaya-ai-repository:db", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return {
        url: pathToFileURL(resolve(`${specifier.slice(2)}.ts`)).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "citaya-ai-repository:db") {
      return {
        format: "module",
        source:
          "export const supabaseAdmin = globalThis.__citayaAIRepository.supabaseAdmin;",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { SupabaseCitayaAppReadRepository } = await import(
  pathToFileURL(resolve("lib/ai/server/citaya-app-repository.ts")).href
);

test("cada consulta de IA conserva el filtro tenant_id", async () => {
  state.queries = [];
  const repository = new SupabaseCitayaAppReadRepository();
  await repository.listAppointmentsForRange({
    tenantId: TENANT,
    startIso: "2026-09-22T03:00:00Z",
    endIso: "2026-09-23T03:00:00Z",
  });
  await repository.listCustomers(TENANT);
  await repository.listPastCustomerAppointments({
    tenantId: TENANT,
    customerIds: ["customer-a"],
    throughIso: "2026-09-22T15:00:00Z",
  });
  await repository.listPendingReceivables({ tenantId: TENANT, limit: 50 });

  assert.equal(state.queries.length, 4);
  for (const query of state.queries) {
    assert.ok(
      query.filters.some(
        ([operator, key, value]) =>
          operator === "eq" && key === "tenant_id" && value === TENANT,
      ),
      `${query.table} perdió el tenant binding`,
    );
  }
});
