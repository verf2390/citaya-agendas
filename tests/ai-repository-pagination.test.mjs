import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const customers = Array.from({ length: 1_001 }, (_, index) => ({
  id: `customer-${String(index).padStart(4, "0")}`,
  full_name: `Customer ${index}`,
}));
const receivables = Array.from({ length: 1_001 }, (_, index) => ({
  id: `appointment-${String(index).padStart(4, "0")}`,
  customer_id: `customer-${index}`,
  customer_name: `Customer ${index}`,
  service_name: "Consulta",
  start_at: "2026-09-01T12:00:00Z",
  status: "confirmed",
  booking_status: "confirmed",
  payment_status: "pending",
  payment_required_amount: 10_000,
  payment_paid_amount: 0,
  payment_remaining_amount: 10_000,
}));
const state = { queries: [] };

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.from = 0;
    this.to = 499;
    this.isReceivable = false;
  }
  select() { return this; }
  eq(key, value) { this.filters.push(["eq", key, value]); return this; }
  gte() { return this; }
  lt() { return this; }
  lte() { return this; }
  in() { return this; }
  order() { return this; }
  or() { this.isReceivable = true; return this; }
  range(from, to) { this.from = from; this.to = to; return this; }
  abortSignal() { return this; }
  then(resolvePromise, rejectPromise) {
    state.queries.push(this);
    const source = this.table === "customers"
      ? customers
      : this.isReceivable
        ? receivables
        : [];
    return Promise.resolve({
      data: source.slice(this.from, this.to + 1),
      error: null,
    }).then(resolvePromise, rejectPromise);
  }
}

globalThis.__citayaAIPaginationRepository = {
  supabaseAdmin: {
    from(table) {
      return new Query(table);
    },
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabaseAdmin") {
      return { url: "citaya-ai-pagination:db", shortCircuit: true };
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
    if (url === "citaya-ai-pagination:db") {
      return {
        format: "module",
        source:
          "export const supabaseAdmin = globalThis.__citayaAIPaginationRepository.supabaseAdmin;",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { SupabaseCitayaAppReadRepository } = await import(
  pathToFileURL(resolve("lib/ai/server/citaya-app-repository.ts")).href
);

test("el repositorio pagina todos los clientes sin perder el tenant binding", async () => {
  state.queries = [];
  const repository = new SupabaseCitayaAppReadRepository();
  const rows = await repository.listCustomers({ tenantId: TENANT });

  assert.equal(rows.length, 1_001);
  assert.equal(state.queries.length, 3);
  for (const query of state.queries) {
    assert.ok(
      query.filters.some(
        ([operator, key, value]) =>
          operator === "eq" && key === "tenant_id" && value === TENANT,
      ),
    );
  }
});

test("el repositorio pagina todos los candidatos a saldo pendiente", async () => {
  state.queries = [];
  const repository = new SupabaseCitayaAppReadRepository();
  const rows = await repository.listPendingReceivables({ tenantId: TENANT });

  assert.equal(rows.length, 1_001);
  assert.equal(state.queries.length, 3);
  assert.equal(rows.at(-1)?.id, "appointment-1000");
});
