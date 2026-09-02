import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("demo payment settings never expose or persist arbitrary bank data", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/payment-settings/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /const DEMO_BANK_SETTINGS = \{/);
  assert.match(route, /bankAccountNumber: "DEMO-NO-TRANSFERIR"/);
  assert.match(route, /bankAccountHolder: "EMPRESA DEMO CITAYA"/);
  assert.match(route, /bankRut: "00\.000\.000-0"/);
  assert.match(route, /bankEmail: "demo@citaya\.invalid"/);

  assert.match(
    route,
    /access\.operationalMode === "demo"[\s\S]*\? DEMO_BANK_SETTINGS/,
  );

  assert.match(
    route,
    /if \(access\.operationalMode === "demo"\) \{[\s\S]*paymentSettingsPayload\.bank_account_number = DEMO_BANK_SETTINGS\.bankAccountNumber;[\s\S]*paymentSettingsPayload\.bank_email = DEMO_BANK_SETTINGS\.bankEmail;/,
  );
});
