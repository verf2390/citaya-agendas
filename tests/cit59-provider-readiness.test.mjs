import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { tenantCredentialUpdates } from "../services/payments/payment-settings-credentials.ts";
import {
  getKhipuCredentials,
  getWebpayCredentials,
} from "../services/payments/provider-credentials.ts";
import { evaluateTenantPaymentReadiness } from "../services/payments/provider-readiness.ts";

function paymentConfig(overrides = {}) {
  return {
    settingsFound: true,
    paymentMethodsValid: true,
    enabled: true,
    mode: "optional",
    provider: "mercadopago",
    depositType: null,
    depositValue: null,
    paymentMethodsEnabled: [],
    collectionMode: "full",
    webpayEnvironment: "integration",
    khipuEnvironment: "development",
    ...overrides,
  };
}

test("CIT-59 payment settings and empty or invalid methods fail closed", () => {
  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({ settingsFound: false, enabled: false }),
    ).ready,
    false,
  );
  assert.equal(evaluateTenantPaymentReadiness(paymentConfig()).ready, false);
  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({
        paymentMethodsValid: false,
        paymentMethodsEnabled: ["manual"],
      }),
    ).ready,
    false,
  );
});

test("CIT-59 manual readiness requires the complete persisted bank destination", () => {
  const incomplete = paymentConfig({ paymentMethodsEnabled: ["manual"] });
  assert.equal(evaluateTenantPaymentReadiness(incomplete).ready, false);

  const configured = paymentConfig({
    paymentMethodsEnabled: ["manual"],
    bankName: "Banco",
    bankAccountType: "Corriente",
    bankAccountNumber: "123456",
    bankAccountHolder: "Comercio",
    bankRut: "78195645-7",
    bankEmail: "pagos@example.test",
  });
  assert.equal(evaluateTenantPaymentReadiness(configured).ready, true);
});

test("CIT-59 Mercado Pago requires only the access token used by the current flow", () => {
  const missing = paymentConfig({ paymentMethodsEnabled: ["mercadopago"] });
  assert.equal(evaluateTenantPaymentReadiness(missing).ready, false);

  const configured = paymentConfig({
    paymentMethodsEnabled: ["mercadopago"],
    accessToken: "tenant-access-token",
  });
  assert.equal(evaluateTenantPaymentReadiness(configured).ready, true);
  assert.equal(configured.publicKey, undefined);
});

test("CIT-59 Webpay and Khipu fail closed when any required credential is absent", () => {
  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({
        paymentMethodsEnabled: ["webpay"],
        webpayCommerceCode: "commerce",
      }),
    ).ready,
    false,
  );
  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({
        paymentMethodsEnabled: ["khipu"],
        khipuReceiverId: "receiver",
      }),
    ).ready,
    false,
  );
});

test("CIT-59 partial admin payloads preserve every existing provider credential", () => {
  assert.deepEqual(
    tenantCredentialUpdates({
      mercadopagoAccessToken: "",
      mercadopagoPublicKey: null,
      webpayCommerceCode: " ",
      webpayApiKey: undefined,
      khipuReceiverId: "",
      khipuSecret: null,
    }),
    {},
  );
  assert.deepEqual(
    tenantCredentialUpdates({ mercadopagoAccessToken: "  new-token  " }),
    { mercadopago_access_token: "new-token" },
  );
});

test("CIT-59 credential sources are complete and tenant maps never cross tenants", () => {
  const names = [
    "CITAYA_WEBPAY_CREDENTIALS_JSON",
    "CITAYA_KHIPU_CREDENTIALS_JSON",
    "WEBPAY_COMMERCE_CODE",
    "WEBPAY_API_KEY",
    "WEBPAY_ENVIRONMENT",
    "KHIPU_RECEIVER_ID",
    "KHIPU_API_KEY",
    "KHIPU_ENVIRONMENT",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.CITAYA_WEBPAY_CREDENTIALS_JSON = JSON.stringify({
      "tenant-a": {
        commerceCode: "commerce-a",
        apiKey: "key-a",
        environment: "integration",
      },
    });
    process.env.CITAYA_KHIPU_CREDENTIALS_JSON = JSON.stringify({
      "tenant-a": {
        receiverId: "receiver-a",
        apiKey: "key-a",
        environment: "development",
      },
    });
    assert.equal(getWebpayCredentials("tenant-a")?.commerceCode, "commerce-a");
    assert.equal(getWebpayCredentials("tenant-a")?.source, "tenant-map");
    assert.equal(getWebpayCredentials("tenant-b"), null);
    assert.equal(getKhipuCredentials("tenant-a")?.receiverId, "receiver-a");
    assert.equal(getKhipuCredentials("tenant-a")?.source, "tenant-map");
    assert.equal(getKhipuCredentials("tenant-b"), null);

    process.env.WEBPAY_COMMERCE_CODE = "global-commerce";
    process.env.WEBPAY_API_KEY = "global-key";
    process.env.WEBPAY_ENVIRONMENT = "integration";
    assert.equal(getWebpayCredentials("tenant-b")?.source, "global-env");
    assert.equal(
      getWebpayCredentials("tenant-a", {
        commerceCode: "tenant-commerce",
        apiKey: "",
        environment: "production",
      }),
      null,
      "partial tenant credentials must not be completed from legacy env",
    );
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("CIT-59 admin GET masks Mercado Pago and DTE stays pre-network", () => {
  const adminRoute = readFileSync(
    "app/api/admin/payment-settings/route.ts",
    "utf8",
  );
  const createRoute = readFileSync("app/api/payments/create/route.ts", "utf8");
  const webpayReturn = readFileSync(
    "app/api/payments/webpay/return/route.ts",
    "utf8",
  );
  const khipuWebhook = readFileSync(
    "app/api/webhooks/khipu/route.ts",
    "utf8",
  );
  const finalize = readFileSync(
    "migrations/202608220002_fix_finalize_verified_payment_schedule_event_column.sql",
    "utf8",
  );
  const gate = readFileSync(
    "migrations/202608260001_cit33_allow_owned_last_folio.sql",
    "utf8",
  );

  assert.match(adminRoute, /mercadopagoAccessTokenConfigured/);
  assert.match(adminRoute, /tenantCredentialUpdates\(body\)/);
  assert.match(
    adminRoute,
    /mercadopagoAccessTokenPreview: maskSecret\(config\.accessToken\)/,
  );
  assert.doesNotMatch(
    adminRoute,
    /mercadopagoAccessToken:\s*config\.accessToken/,
  );
  assert.match(createRoute, /!config\.enabled \|\| !config\.configured/);
  assert.match(webpayReturn, /if \(!paymentConfig\.settingsFound\).*failure/);
  assert.match(khipuWebhook, /if \(!paymentConfig\.settingsFound\).*reject\(503\)/);
  assert.match(finalize, /finalize_verified_payment/);
  assert.match(finalize, /dte_enqueue_payment_snapshot/);
  assert.match(finalize, /p_provider in \('khipu','webpay','mercadopago'\)/);
  assert.match(gate, /i\.origin = 'automatic_payment'/);
  assert.match(gate, /i\.trigger_source <> 'manual_verified'[\s\S]*tenant\.operational_mode = 'live'/);
  assert.doesNotMatch(
    `${adminRoute}\n${createRoute}`,
    /queryStatusManually|uploadExactlyOnce|reserve_folio|submit.*sii/i,
  );
});
