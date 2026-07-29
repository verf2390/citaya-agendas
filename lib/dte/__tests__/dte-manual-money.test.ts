import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateManualMoney,
  manualReviewMaterial,
  validateManualGrossLines,
} from "../manual-money";

test("standalone gross 5000 persists as 4202 net plus 798 VAT", () => {
  const lines = validateManualGrossLines([{
    description: "Servicio afecto",
    quantity: 1,
    unitGrossAmount: 5_000,
  }]);
  const preview = calculateManualMoney(lines, false);
  const persisted = calculateManualMoney(lines, false);

  assert.deepEqual(preview, {
    grossAmount: 5_000,
    netAmount: 4_202,
    exemptAmount: 0,
    taxAmount: 798,
  });
  assert.deepEqual(persisted, preview);
  assert.equal(lines[0]?.grossAmount, 5_000);
});

test("browser net and VAT fields cannot alter the server calculation", () => {
  const lines = validateManualGrossLines([{
    description: "Servicio afecto",
    quantity: 1,
    unitGrossAmount: 5_000,
    netAmount: 1,
    taxAmount: 4_999,
  }]);
  assert.deepEqual(calculateManualMoney(lines, false), {
    grossAmount: 5_000,
    netAmount: 4_202,
    exemptAmount: 0,
    taxAmount: 798,
  });
});

test("preview fingerprint binds the exact server-side gross contract", () => {
  const lines = validateManualGrossLines([{
    description: "Servicio afecto",
    quantity: 1,
    unitGrossAmount: 5_000,
  }]);
  const money = calculateManualMoney(lines, false);
  const base = {
    tenantId: "00000000-0000-4000-8000-000000000010",
    source: "standalone",
    dteType: 33,
    customerId: "00000000-0000-4000-8000-000000000020",
    appointmentId: null,
    paymentIntentId: null,
    lines,
    money,
  };
  assert.equal(manualReviewMaterial(base), manualReviewMaterial(base));

  const changedLines = validateManualGrossLines([{
    description: "Servicio afecto",
    quantity: 1,
    unitGrossAmount: 4_202,
  }]);
  assert.notEqual(
    manualReviewMaterial(base),
    manualReviewMaterial({
      ...base,
      lines: changedLines,
      money: calculateManualMoney(changedLines, false),
    }),
  );
});
