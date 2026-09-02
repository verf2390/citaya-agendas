import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { tenantCredentialUpdates } from "../services/payments/payment-settings-credentials.ts";
import {
  getTenantKhipuCredentials,
  getTenantWebpayCredentials,
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
  const missing = evaluateTenantPaymentReadiness(
    paymentConfig({
      settingsFound: false,
      enabled: false,
      paymentMethodsEnabled: ["mercadopago"],
      accessToken: "must-not-count-without-settings",
    }),
  );
  assert.equal(missing.ready, false);
  assert.equal(missing.methods.mercadopago.configured, false);
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

test("CIT-59 readiness uses exact positive mode and collection allowlists", () => {
  const configured = {
    paymentMethodsEnabled: ["manual"],
    bankName: "Banco",
    bankAccountType: "Corriente",
    bankAccountNumber: "123456",
    bankAccountHolder: "Comercio",
    bankRut: "78195645-7",
    bankEmail: "pagos@example.test",
  };

  for (const mode of ["legacy", null, undefined, "none"]) {
    assert.equal(
      evaluateTenantPaymentReadiness(paymentConfig({ ...configured, mode })).ready,
      false,
    );
  }
  for (const collectionMode of ["legacy", null, undefined, "none"]) {
    assert.equal(
      evaluateTenantPaymentReadiness(
        paymentConfig({ ...configured, collectionMode }),
      ).ready,
      false,
    );
  }

  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({ ...configured, mode: "optional", collectionMode: "full" }),
    ).ready,
    true,
  );
  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({ ...configured, mode: "required", collectionMode: "deposit" }),
    ).ready,
    true,
  );
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

test("CIT-59 Webpay and Khipu require exact persisted environments", () => {
  const webpay = {
    paymentMethodsEnabled: ["webpay"],
    webpayCommerceCode: "commerce",
    webpayApiKey: "api-key",
  };
  const khipu = {
    paymentMethodsEnabled: ["khipu"],
    khipuReceiverId: "receiver",
    khipuSecret: "secret",
  };

  for (const webpayEnvironment of ["legacy", " production ", null, undefined]) {
    assert.equal(
      evaluateTenantPaymentReadiness(
        paymentConfig({ ...webpay, webpayEnvironment }),
      ).ready,
      false,
    );
  }
  for (const khipuEnvironment of ["legacy", " production ", null, undefined]) {
    assert.equal(
      evaluateTenantPaymentReadiness(
        paymentConfig({ ...khipu, khipuEnvironment }),
      ).ready,
      false,
    );
  }

  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({ ...webpay, webpayEnvironment: "production" }),
    ).ready,
    true,
  );
  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({ ...khipu, khipuEnvironment: "development" }),
    ).ready,
    true,
  );
});

test("CIT-59 active false and an incomplete enabled peer fail the whole tenant", () => {
  const manual = {
    paymentMethodsEnabled: ["manual"],
    bankName: "Banco",
    bankAccountType: "Corriente",
    bankAccountNumber: "123456",
    bankAccountHolder: "Comercio",
    bankRut: "78195645-7",
    bankEmail: "pagos@example.test",
  };
  assert.equal(
    evaluateTenantPaymentReadiness(paymentConfig({ ...manual, enabled: false }))
      .ready,
    false,
  );
  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({
        ...manual,
        paymentMethodsEnabled: ["manual", "mercadopago"],
      }),
    ).ready,
    false,
  );
  assert.equal(
    evaluateTenantPaymentReadiness(
      paymentConfig({
        ...manual,
        paymentMethodsEnabled: ["manual", "mercadopago"],
        accessToken: "tenant-token",
      }),
    ).ready,
    true,
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
    { ok: true, updates: {} },
  );
  assert.deepEqual(
    tenantCredentialUpdates({ mercadopagoAccessToken: "  new-token  " }),
    { ok: true, updates: { mercadopago_access_token: "new-token" } },
  );
  assert.deepEqual(tenantCredentialUpdates({}), { ok: true, updates: {} });
});

test("CIT-59 malformed credential values are rejected with HTTP 400 semantics", () => {
  const malformedPayloads = [
    { mercadopagoAccessToken: {} },
    { webpayApiKey: [] },
    { khipuSecret: 123 },
    { mercadopagoAccessToken: true },
  ];
  for (const payload of malformedPayloads) {
    assert.deepEqual(tenantCredentialUpdates(payload), {
      ok: false,
      status: 400,
      error: "Credenciales inválidas",
    });
  }
});

test("CIT-59 commercial credentials are tenant-persisted even when legacy env exists", () => {
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
    process.env.WEBPAY_COMMERCE_CODE = "global-commerce";
    process.env.WEBPAY_API_KEY = "global-key";
    process.env.WEBPAY_ENVIRONMENT = "integration";
    process.env.KHIPU_RECEIVER_ID = "global-receiver";
    process.env.KHIPU_API_KEY = "global-key";
    process.env.KHIPU_ENVIRONMENT = "production";

    assert.equal(
      getTenantWebpayCredentials({
        commerceCode: "tenant-a-commerce",
        apiKey: "tenant-a-key",
        environment: "production",
      })?.source,
      "tenant",
    );
    assert.equal(
      getTenantKhipuCredentials({
        receiverId: "tenant-a-receiver",
        apiKey: "tenant-a-key",
        environment: "production",
      })?.source,
      "tenant",
    );

    assert.equal(getTenantWebpayCredentials(), null);
    assert.equal(getTenantKhipuCredentials(), null);
    assert.equal(
      getTenantWebpayCredentials({
        commerceCode: "tenant-b-commerce",
        apiKey: "tenant-b-key",
        environment: " production ",
      }),
      null,
      "persisted Webpay environments must match the SQL allowlist exactly",
    );
    assert.equal(
      getTenantKhipuCredentials({
        receiverId: "tenant-b-receiver",
        apiKey: "tenant-b-key",
        environment: " production ",
      }),
      null,
      "persisted Khipu environments must match the SQL allowlist exactly",
    );
    assert.equal(
      getTenantWebpayCredentials({
        commerceCode: "tenant-b-commerce",
        apiKey: "",
        environment: "production",
      }),
      null,
      "tenant B must not complete Webpay credentials from legacy env",
    );
    assert.equal(
      getTenantKhipuCredentials({
        receiverId: "tenant-b-receiver",
        apiKey: "",
        environment: "production",
      }),
      null,
      "tenant B must not complete Khipu credentials from legacy env",
    );

    assert.equal(
      evaluateTenantPaymentReadiness(
        paymentConfig({ paymentMethodsEnabled: ["webpay"] }),
      ).ready,
      false,
    );
    assert.equal(
      evaluateTenantPaymentReadiness(
        paymentConfig({ paymentMethodsEnabled: ["khipu"] }),
      ).ready,
      false,
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
  const providerFactory = readFileSync(
    "services/payments/provider-factory.ts",
    "utf8",
  );
  const providerCredentials = readFileSync(
    "services/payments/provider-credentials.ts",
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
    /if \(!credentialUpdates\.ok\)[\s\S]*status: credentialUpdates\.status/,
  );
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
  assert.match(
    providerFactory,
    /readiness\.ready && readiness\.methods\[providerId\]\.enabled/,
  );
  assert.match(providerFactory, /getTenantWebpayCredentials/);
  assert.match(providerFactory, /getTenantKhipuCredentials/);
  assert.doesNotMatch(providerCredentials, /process\.env|tenant-map|global-env/);
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
