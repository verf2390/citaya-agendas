import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return {
        url: pathToFileURL(resolve(`${specifier.slice(2)}.ts`)).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { createCitayaAppReadTools } = await import(
  pathToFileURL(resolve("lib/ai/tools/citaya-app-read.ts")).href
);

const TENANT = "11111111-1111-4111-8111-111111111111";
const context = {
  tenantId: TENANT,
  userId: "22222222-2222-4222-8222-222222222222",
  tenantSlug: "tenant-a",
  timezone: "America/Santiago",
  now: new Date("2026-09-22T15:00:00.000Z"),
};

function toolsByName(repository) {
  return new Map(
    createCitayaAppReadTools(repository).map((tool) => [
      tool.definition.name,
      tool,
    ]),
  );
}

test("count_appointments usa el día de Santiago y tenant del contexto", async () => {
  const calls = [];
  const repository = {
    async listAppointmentsForRange(input) {
      calls.push(input);
      return [
        { id: "1", status: "confirmed", booking_status: "confirmed" },
        { id: "2", status: "cancelled", booking_status: "cancelled" },
        { id: "3", status: "pending", booking_status: "pending" },
      ];
    },
  };
  const tool = toolsByName(repository).get("count_appointments");
  const result = await tool.execute({ date: "2026-09-23" }, context);

  assert.deepEqual(calls, [
    {
      tenantId: TENANT,
      startIso: "2026-09-23T03:00:00.000Z",
      endIso: "2026-09-24T03:00:00.000Z",
      signal: undefined,
    },
  ]);
  assert.deepEqual(result, {
    date: "2026-09-23",
    timezone: "America/Santiago",
    active: 2,
    canceled: 1,
    total: 3,
  });
});

test("list_inactive_customers devuelve visitas antiguas y excluye canceladas", async () => {
  const repository = {
    async listCustomers(input) {
      assert.equal(input.tenantId, TENANT);
      return [
        { id: "c1", full_name: "Ana" },
        { id: "c2", full_name: "Luis" },
        { id: "c3", full_name: "Sin visita" },
      ];
    },
    async listPastCustomerAppointments(input) {
      assert.equal(input.tenantId, TENANT);
      return [
        {
          customer_id: "c1",
          start_at: "2026-06-01T12:00:00Z",
          service_name: "Control",
          status: "confirmed",
          booking_status: "confirmed",
        },
        {
          customer_id: "c2",
          start_at: "2026-05-01T12:00:00Z",
          service_name: "Cancelada",
          status: "cancelled",
          booking_status: "cancelled",
        },
        {
          customer_id: "c2",
          start_at: "2026-09-01T12:00:00Z",
          service_name: "Consulta",
          status: "confirmed",
          booking_status: "confirmed",
        },
      ];
    },
  };
  const tool = toolsByName(repository).get("list_inactive_customers");
  const result = await tool.execute({ days: 60, limit: 10 }, context);

  assert.equal(result.totalMatched, 1);
  assert.equal(result.customers[0].customerId, "c1");
  assert.equal(result.customers[0].lastService, "Control");
});

test("get_pending_receivables suma CLP sin ejecutar acciones", async () => {
  const repository = {
    async listPendingReceivables(input) {
      assert.equal(input.tenantId, TENANT);
      return [
        {
          id: "a1",
          customer_id: "c1",
          customer_name: "Ana",
          service_name: "Control",
          start_at: "2026-09-20T12:00:00Z",
          status: "confirmed",
          booking_status: "confirmed",
          payment_status: "pending",
          payment_required_amount: 15000,
          payment_paid_amount: 5000,
          payment_remaining_amount: 10000,
        },
        {
          id: "a2",
          customer_id: "c2",
          customer_name: "Luis",
          service_name: "Consulta",
          start_at: "2026-09-18T12:00:00Z",
          status: "confirmed",
          booking_status: "confirmed",
          payment_status: "pending",
          payment_required_amount: 20000,
          payment_paid_amount: 0,
          payment_remaining_amount: null,
        },
      ];
    },
  };
  const tool = toolsByName(repository).get("get_pending_receivables");
  const result = await tool.execute({ limit: 10 }, context);

  assert.equal(result.currency, "CLP");
  assert.equal(result.count, 2);
  assert.equal(result.total, 30000);
  assert.deepEqual(
    result.items.map((item) => item.amount),
    [20000, 10000],
  );
});
