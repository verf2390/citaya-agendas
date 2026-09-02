import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { paymentDisplayTotal } from "../lib/payments/payment-display-total.ts";

const paymentsSource = readFileSync("app/admin/pagos/page.tsx", "utf8");

test("CIT-34 displays 59.440 total with no advance, 0 paid and 59.440 remaining", () => {
  const row = {
    payment_required_amount: 0,
    payment_paid_amount: 0,
    payment_remaining_amount: 59_440,
  };

  assert.equal(paymentDisplayTotal(row), 59_440);
  assert.equal(row.payment_paid_amount, 0);
  assert.equal(row.payment_remaining_amount, 59_440);
});

test("CIT-34 displays 59.440 total when fully paid", () => {
  const row = {
    payment_required_amount: 59_440,
    payment_paid_amount: 59_440,
    payment_remaining_amount: 0,
  };

  assert.equal(paymentDisplayTotal(row), 59_440);
  assert.equal(row.payment_paid_amount, 59_440);
  assert.equal(row.payment_remaining_amount, 0);
});

test("CIT-34 falls back conservatively for legacy rows without a complete snapshot", () => {
  assert.equal(
    paymentDisplayTotal({
      payment_required_amount: 59_440,
      payment_paid_amount: null,
      payment_remaining_amount: null,
    }),
    59_440,
  );
});

test("CIT-34 keeps payment_required_amount as the advance instead of the total", () => {
  assert.equal(
    paymentDisplayTotal({
      payment_required_amount: 10_000,
      payment_paid_amount: 10_000,
      payment_remaining_amount: 49_440,
    }),
    59_440,
  );
});

test("CIT-34 wires the derived total while retaining paid and remaining details", () => {
  assert.match(paymentsSource, /formatCLP\(paymentDisplayTotal\(row\)\)/);
  assert.match(paymentsSource, /Pagado \{formatCLP\(row\.payment_paid_amount\)\}/);
  assert.match(paymentsSource, /Saldo \{formatCLP\(row\.payment_remaining_amount\)\}/);
  assert.doesNotMatch(
    paymentsSource,
    /className="font-bold">\{formatCLP\(row\.payment_required_amount\)\}/,
  );
});
