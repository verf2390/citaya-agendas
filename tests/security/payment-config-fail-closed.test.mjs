import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../services/payments/payment-config.ts", import.meta.url),
  "utf8",
);

test("payment config fails closed when provider settings are absent", () => {
  assert.match(
    source,
    /function parsePaymentMethods\(value: unknown\)[\s\S]*if \(!Array\.isArray\(value\)\) return \[\];/,
  );

  assert.match(
    source,
    /if \(error \|\| !data\)[\s\S]*enabled: false,[\s\S]*paymentMethodsEnabled: \[\],[\s\S]*collectionMode: 'none'/,
  );

  assert.doesNotMatch(
    source,
    /Array\.isArray\(value\) \? value : \['mercadopago'\]/,
  );

  assert.doesNotMatch(
    source,
    /methods\.length > 0 \? methods : \['mercadopago'\]/,
  );
});

test("explicit persisted provider arrays remain filtered to supported providers", () => {
  assert.match(
    source,
    /return value\.filter\(\(item\): item is PaymentProviderId =>[\s\S]*PAYMENT_PROVIDERS\.includes/,
  );
});
