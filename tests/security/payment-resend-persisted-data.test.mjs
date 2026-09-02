import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("payment resend derives recipient, link and amount from persisted appointment data", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/payments/resend/route.ts", import.meta.url),
    "utf8",
  );
  const page = readFileSync(
    new URL("../../app/admin/pagos/page.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    route,
    /body\.(customerEmail|customerName|paymentLink|amount)/,
  );

  assert.match(
    route,
    /customer_name, customer_email, service_name, start_at, payment_url, payment_remaining_amount, payment_required_amount/,
  );

  assert.match(
    route,
    /customerEmail = String\(appointment\.customer_email/,
  );
  assert.match(
    route,
    /paymentLink = String\(appointment\.payment_url/,
  );
  assert.match(
    route,
    /remainingAmount = Number\(appointment\.payment_remaining_amount/,
  );
  assert.match(
    route,
    /requiredAmount = Number\(appointment\.payment_required_amount/,
  );

  assert.match(
    route,
    /customerEmail,[\s\S]*customerName: String\(appointment\.customer_name[\s\S]*paymentLink,[\s\S]*amount,/,
  );

  assert.match(
    page,
    /body: JSON\.stringify\(\{\s*appointmentId: row\.id,\s*tenantSlug,\s*\}\)/,
  );

  assert.doesNotMatch(
    page,
    /body: JSON\.stringify\(\{[\s\S]{0,300}customerEmail: row\.customer_email/,
  );
});
