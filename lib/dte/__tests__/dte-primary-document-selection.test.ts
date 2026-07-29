import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogGrossPriceToNet,
  InMemoryPaymentInvoiceCoordinator,
} from "../invoice-drafts";

const base = {
  tenantId: "tenant-a",
  paymentId: "payment-a",
  paymentKey: "verified:webhook-a",
  amount: 44_980,
  currency: "CLP",
  confirmed: true,
  fullPayment: true,
  issuer: null,
  recipient: null,
  lines: [
    {
      description: "Servicio A",
      quantity: 1,
      unitNetAmount: catalogGrossPriceToNet(14_990),
      pricingMode: "catalog_gross" as const,
      catalogUnitGrossAmount: 14_990,
    },
    {
      description: "Servicio B",
      quantity: 1,
      unitNetAmount: catalogGrossPriceToNet(29_990),
      pricingMode: "catalog_gross" as const,
      catalogUnitGrossAmount: 29_990,
    },
  ],
};

test("FOCAL un pago elige un documento primario, reintenta idempotente y no encola con automatización apagada", () => {
  const coordinator = new InMemoryPaymentInvoiceCoordinator();
  const first = coordinator.confirmPayment(
    { ...base, requestedDocumentType: 39 },
    false,
  );
  const duplicate = coordinator.confirmPayment(
    { ...base, requestedDocumentType: 39 },
    false,
  );
  assert.equal(first.id, duplicate.id);
  assert.equal(first.dteType, 39);
  assert.equal(first.status, "REVIEW_REQUIRED");
  assert.equal(first.folio, null);
  assert.equal(first.enqueueCount, 0);
  assert.equal(first.executableOutboxCount, 0);
  assert.equal(coordinator.draftCount(), 1);
  assert.throws(
    () =>
      coordinator.confirmPayment(
        { ...base, requestedDocumentType: 33 },
        false,
      ),
    /DTE_PRIMARY_DOCUMENT_ALREADY_SELECTED/,
  );
  assert.throws(
    () =>
      coordinator.confirmPayment(
        {
          ...base,
          paymentKey: "verified:historical",
          paymentId: "payment-historical",
          requestedDocumentType: null,
        },
        false,
      ),
    /DTE_DOCUMENT_SELECTION_REQUIRED/,
  );
});
