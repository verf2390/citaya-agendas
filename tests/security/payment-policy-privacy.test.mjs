import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateMixedSalePolicy,
  calculateServicePolicySnapshot,
} from "../../services/payments/service-payment-policy.mjs";
import { safePaymentAuditMetadata } from "../../lib/security/payment-verification.mjs";

test("service policies calculate no advance, integer deposit and full payment", () => {
  const cases = [
    ["no_advance", null, null, 0n, 10_001n],
    ["deposit", "percentage", 3333n, 3_333n, 10_001n],
    ["deposit", "fixed_amount", 2_500n, 2_500n, 10_001n],
    ["full_payment", null, null, 10_001n, 10_001n],
  ];
  for (const [paymentPolicy, depositType, depositValue, initial, balance] of cases) {
    const snapshot = calculateServicePolicySnapshot({
      serviceId: "fictional-service", totalAmount: 10_001n,
      paymentPolicy, depositType, depositValue,
    });
    assert.equal(snapshot.initialPaymentDue, initial);
    assert.equal(snapshot.balanceDue, balance);
  }
});

test("mixed sale sums line requirements and snapshots do not depend on catalog mutation", () => {
  const catalog = [
    { serviceId: "a", totalAmount: 10_000n, paymentPolicy: "no_advance" },
    { serviceId: "b", totalAmount: 20_000n, paymentPolicy: "deposit", depositType: "percentage", depositValue: 2500n },
    { serviceId: "c", totalAmount: 30_000n, paymentPolicy: "full_payment" },
  ];
  const sale = calculateMixedSalePolicy(catalog);
  catalog[1].totalAmount = 99_999n;
  assert.equal(sale.totalAmount, 60_000n);
  assert.equal(sale.initialPaymentDue, 35_000n);
  assert.equal(sale.balanceDue, 60_000n);
  assert.equal(sale.taxTreatmentStatus, "REVIEW_REQUIRED");
});

test("webhook audit allowlist excludes full payload and secrets", () => {
  const safe = safePaymentAuditMetadata("mercadopago", {
    id: "123", status: "approved", date_approved: "2026-08-02T00:00:00Z",
    card_number: "4111111111111111", cvv: "999", payer: { email: "person@example.invalid" },
  });
  assert.deepEqual(Object.keys(safe).sort(), ["date_approved", "payment_id", "status"]);
  assert.doesNotMatch(JSON.stringify(safe), /4111|999|example\.invalid/);
});

test("source gates tax descriptions, minimizes boleta, and preserves tenant-scoped invoice lookup", () => {
  const manual = readFileSync("app/api/admin/dte-intents/manual/route.ts", "utf8");
  const booking = readFileSync("app/reservar/page.tsx", "utf8");
  const lookup = readFileSync("app/api/customers/tax-profile/lookup/route.ts", "utf8");
  const verification = readFileSync("app/api/public/boleta-verification/route.ts", "utf8");
  assert.match(manual, /tax_description_review_status !== "approved"/);
  assert.match(manual, /consumerIdentityIncluded: false/);
  assert.doesNotMatch(booking, /value=\{customerRut\}/);
  assert.match(lookup, /\.eq\("tenant_id", tenantId\)/);
  assert.match(lookup, /\.eq\("rut_normalized", normalizedRut\)/);
  assert.match(verification, /consumeRateLimit/);
  assert.match(verification, /issuerRut.*folio.*issueDate.*totalAmount/s);
  assert.doesNotMatch(verification, /customer_email|customer_phone|receiver_snapshot|xml/i);
});

test("migration tables are PII-minimal and no automatic retention deletion exists", () => {
  const sql = readFileSync("migrations/202608020002_service_payment_policy_sales_coverage.sql", "utf8");
  for (const table of ["billing_payment_schedule", "billing_sale_payments", "billing_sale_item_document_coverage"]) {
    const body = sql.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? "";
    assert.ok(body);
    assert.doesNotMatch(body, /customer_name|rut|email|phone|address|health|clinical|notes|payload/i);
  }
  assert.match(sql, /automation_enabled boolean not null default false check \(automation_enabled=false\)/);
  assert.match(sql, /minimum_days >= 2190/);
  assert.doesNotMatch(sql, /delete from public\.(dte|billing|legal)/i);
});
