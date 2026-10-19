import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCustomerReturnPath,
  resolveCustomerUpsertFlow,
} from "../lib/admin/customer-flow.mjs";

const customers = [
  { id: "tenant-customer", full_name: "Cliente tenant" },
];

test("customer flow opens create and returns to an internal billing path", () => {
  const flow = resolveCustomerUpsertFlow(
    new URLSearchParams("new=1&returnTo=/admin/facturacion"),
    customers,
  );

  assert.equal(flow.shouldOpen, true);
  assert.equal(flow.editing, null);
  assert.equal(flow.returnTo, "/admin/facturacion");
  assert.equal(
    buildCustomerReturnPath(flow.returnTo, "new-customer"),
    "/admin/facturacion?customerId=new-customer",
  );
});

test("customer edit flow only accepts a customer loaded for the current tenant", () => {
  const allowed = resolveCustomerUpsertFlow(
    new URLSearchParams("edit=tenant-customer&returnTo=/admin/facturacion"),
    customers,
  );
  const foreign = resolveCustomerUpsertFlow(
    new URLSearchParams("edit=foreign-customer&returnTo=/admin/facturacion"),
    customers,
  );
  const foreignWithCreateFlag = resolveCustomerUpsertFlow(
    new URLSearchParams("new=1&edit=foreign-customer&returnTo=/admin/facturacion"),
    customers,
  );

  assert.equal(allowed.shouldOpen, true);
  assert.equal(allowed.editing?.id, "tenant-customer");
  assert.equal(foreign.shouldOpen, false);
  assert.equal(foreign.editing, null);
  assert.equal(foreignWithCreateFlag.shouldOpen, false);
});

test("customer edit returns to billing with the edited customer selected", () => {
  const flow = resolveCustomerUpsertFlow(
    new URLSearchParams("edit=tenant-customer&returnTo=/admin/facturacion"),
    customers,
  );

  assert.equal(flow.shouldOpen, true);
  assert.equal(flow.editing?.id, "tenant-customer");
  assert.equal(
    buildCustomerReturnPath(flow.returnTo, flow.editing.id),
    "/admin/facturacion?customerId=tenant-customer",
  );
});

test("customer return rejects open redirects and preserves safe query strings", () => {
  const malicious = resolveCustomerUpsertFlow(
    new URLSearchParams("new=1&returnTo=https://evil.example/collect"),
    customers,
  );

  assert.equal(malicious.returnTo, "");
  assert.equal(buildCustomerReturnPath("//evil.example/collect", "customer-1"), "");
  assert.equal(
    buildCustomerReturnPath("/admin/facturacion?source=manual", "customer 1"),
    "/admin/facturacion?source=manual&customerId=customer+1",
  );
});

test("billing links use the shared customer modal flow and select the returned customer", () => {
  const billingForm = readFileSync(
    new URL("../components/admin/dte/ManualIssuanceForm.tsx", import.meta.url),
    "utf8",
  );
  const customersPage = readFileSync(
    new URL("../app/admin/customers/page.tsx", import.meta.url),
    "utf8",
  );
  const billingPage = readFileSync(
    new URL("../app/admin/facturacion/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    billingForm,
    /\/admin\/customers\?new=1&returnTo=\/admin\/facturacion/,
  );
  assert.match(billingForm, /!savedDraft && !contextLocked/);
  assert.match(billingForm, /Crear cliente/);
  assert.match(
    billingForm,
    /Al ir a Clientes, los cambios sin guardar de este formulario se perderán/,
  );
  const editLinks = billingForm.match(
    /\/admin\/customers\?edit=\$\{encodeURIComponent\(selectedCustomer\.id\)\}&returnTo=\/admin\/facturacion/g,
  );
  assert.equal(editLinks?.length, 2, "both edit links must encode the selected customer id");
  assert.match(billingForm, /Completar datos tributarios/);
  assert.doesNotMatch(billingForm, /<CustomerUpsertModal/);
  assert.match(customersPage, /<CustomerUpsertModal/);
  assert.match(customersPage, /resolveCustomerUpsertFlow/);
  assert.match(customersPage, /if \(flowReturnTo\) router\.push\(flowReturnTo\)/);
  assert.match(billingPage, /params\.has\("customerId"\)/);
  assert.match(billingForm, /params\.get\("customerId"\)/);
  assert.match(billingForm, /loadedCustomers\.some\(\(item\) => item\.id === requestedCustomerId\)/);
  assert.match(billingForm, /setCustomerId\(requestedCustomerId\)/);
});
