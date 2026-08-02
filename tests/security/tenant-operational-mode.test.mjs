import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createDemoSimulation,
  resolveTenantOperationalCapabilities,
} from "../../lib/tenant/operational-mode.mjs";

const matrix = [
  {
    mode: "unclassified",
    allowed: ["informationalPage", "classificationAdmin"],
  },
  {
    mode: "demo",
    allowed: ["informationalPage", "demoSimulation", "ordinaryAdmin"],
  },
  {
    mode: "live",
    allowed: [
      "informationalPage", "createAppointment", "createPayment", "confirmTransfer",
      "acceptPaymentWebhook", "sendExternalEmail", "sendCampaign",
      "callExternalAutomation", "enqueueDte", "runDteWorker",
      "publicTaxDocument", "taxAdministration", "ordinaryAdmin",
    ],
  },
  {
    mode: "internal",
    allowed: ["taxAdministration", "dteCertification", "ordinaryAdmin"],
  },
];

const booleanCapabilities = [
  "informationalPage", "demoSimulation", "createAppointment", "createPayment",
  "confirmTransfer", "acceptPaymentWebhook", "sendExternalEmail", "sendCampaign",
  "callExternalAutomation", "enqueueDte", "runDteWorker", "publicTaxDocument",
  "taxAdministration", "dteCertification", "ordinaryAdmin",
  "exceptionalPlatformAccess", "classificationAdmin",
];

test("tenant operational matrix is explicit and archived always wins", () => {
  for (const row of matrix) {
    const capabilities = resolveTenantOperationalCapabilities({
      lifecycleStatus: "active",
      operationalMode: row.mode,
    });
    for (const capability of booleanCapabilities) {
      assert.equal(
        capabilities[capability],
        row.allowed.includes(capability),
        `${row.mode}.${capability}`,
      );
    }
    const archived = resolveTenantOperationalCapabilities({
      lifecycleStatus: "archived",
      operationalMode: row.mode,
    });
    for (const capability of booleanCapabilities) {
      assert.equal(
        archived[capability],
        capability === "exceptionalPlatformAccess" || capability === "classificationAdmin",
        `archived/${row.mode}.${capability}`,
      );
    }
  }
  assert.equal(
    resolveTenantOperationalCapabilities({ lifecycleStatus: "active", operationalMode: "unknown" }).operationalMode,
    "unclassified",
  );
});

test("demo response is ephemeral, contains no visitor data and the public route exits before writes", () => {
  const first = createDemoSimulation();
  const second = createDemoSimulation();
  assert.equal(first.demoSimulation, true);
  assert.equal(first.persisted, false);
  assert.equal(first.externalContact, false);
  assert.notEqual(first.ephemeralId, second.ephemeralId);
  assert.deepEqual(Object.keys(first).sort(), [
    "demoSimulation", "ephemeralId", "externalContact", "ok", "persisted", "summary",
  ]);
  assert.doesNotMatch(JSON.stringify(first), /name|email|phone|rut|clinical|financial|customer|appointmentId/i);

  const createRoute = readFileSync("app/api/appointments/create/route.ts", "utf8");
  const demoExit = createRoute.indexOf("return NextResponse.json(createDemoSimulation())");
  for (const laterOperation of [
    "getPublicLegalBundleByTenantId", "validateBookingTaxInput", "resolveCustomerId({",
    'supabaseAdmin.rpc(rpcName', "billing_initialize_appointment_sale",
  ]) {
    assert.ok(createRoute.indexOf(laterOperation, demoExit + 1) > demoExit, `${laterOperation} must follow demo exit`);
  }
  assert.doesNotMatch(createRoute, /console\.(?:log|warn|error)\([^\n]*(?:customerName|customerEmail|customerPhone|notes|rut)/i);
});

test("central guards cover external effects, platform classification and type 39 remains gated", () => {
  const requiredSources = new Map([
    ["app/api/payments/create/route.ts", /assertTenantCanCreatePayment/],
    ["app/api/webhooks/mercadopago/route.ts", /acceptPaymentWebhook/],
    ["app/api/webhooks/khipu/route.ts", /acceptPaymentWebhook/],
    ["app/api/payments/webpay/return/route.ts", /acceptPaymentWebhook/],
    ["app/api/admin/campaigns/send/route.ts", /assertTenantCanSendCampaign/],
    ["services/automations/notify-payment-confirmed.ts", /assertTenantCanSendExternalCommunication/],
    ["services/automations/notify-waitlist-slot-released.ts", /assertTenantCanSendExternalCommunication/],
    ["app/api/admin/dte-intents/manual/route.ts", /assertTenantCanEnqueueDte/],
    ["lib/dte/automation/worker.ts", /assertTenantCanRunDteWorker/],
    ["app/api/public/boleta-verification/route.ts", /publicTaxDocument/],
    ["app/api/public/boleta-verification/pdf/route.ts", /publicTaxDocument/],
  ]);
  for (const [file, pattern] of requiredSources) {
    assert.match(readFileSync(file, "utf8"), pattern, file);
  }

  const platformApi = readFileSync("app/api/admin/platform/tenants/route.ts", "utf8");
  assert.match(platformApi, /requirePlatformAdmin/);
  assert.match(platformApi, /set_tenant_operational_mode/);
  assert.match(platformApi, /archive_tenant_for_offboarding/);

  const migration = readFileSync("migrations/202608020005_tenant_operational_mode.sql", "utf8");
  assert.match(migration, /operational_mode text not null default 'unclassified'/);
  assert.match(migration, /create or replace function public\.resolve_tenant_operational_capabilities/);
  assert.match(migration, /create trigger a_tenant_mode_(?:appointments|payment_intents|dte_intents|dte_outbox)/);
  assert.match(migration, /TENANT_MODE_TYPE39_BLOCKED/);
  assert.doesNotMatch(migration, /Fajas|R&G|rg-spa|insert into public\.tenants/i);
  assert.doesNotMatch(migration, /set\s+operational_mode\s*=\s*'(?:demo|live|internal)'\s+where/i);
  assert.doesNotMatch(migration, /issuance_enabled\s*=\s*true|production_enabled\s*=\s*true/i);
});
