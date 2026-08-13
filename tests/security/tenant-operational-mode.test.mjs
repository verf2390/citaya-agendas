import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canRunAppointmentOperationalEffects,
  isSafeDemoAppointmentMode,
  resolveTenantOperationalCapabilities,
} from "../../lib/tenant/operational-mode.mjs";

const matrix = [
  {
    mode: "unclassified",
    allowed: ["informationalPage", "classificationAdmin"],
  },
  {
    mode: "demo",
    allowed: [
      "informationalPage", "demoSimulation", "createAppointment",
      "appointmentOperationalCommunication", "ordinaryAdmin",
    ],
  },
  {
    mode: "live",
    allowed: [
      "informationalPage", "createAppointment", "createPayment", "confirmTransfer",
      "acceptPaymentWebhook", "appointmentOperationalCommunication",
      "sendExternalEmail", "sendCampaign",
      "callExternalAutomation", "enqueueDte", "runDteWorker",
      "manualDteEnqueue", "publicTaxDocument", "taxAdministration", "ordinaryAdmin",
    ],
  },
  {
    mode: "internal",
    allowed: [
      "informationalPage", "manualDteEnqueue", "taxAdministration",
      "dteCertification", "ordinaryAdmin",
    ],
  },
];

const booleanCapabilities = [
  "informationalPage", "demoSimulation", "createAppointment", "createPayment",
  "confirmTransfer", "acceptPaymentWebhook", "appointmentOperationalCommunication",
  "sendExternalEmail", "sendCampaign", "callExternalAutomation", "enqueueDte",
  "manualDteEnqueue", "runDteWorker", "publicTaxDocument", "taxAdministration",
  "dteCertification", "ordinaryAdmin",
  "exceptionalPlatformAccess", "classificationAdmin",
];

test("[behavioral] tenant operational matrix is explicit and archived always wins", () => {
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
  for (const lifecycleStatus of ["suspended", "unknown"]) {
    const capabilities = resolveTenantOperationalCapabilities({
      lifecycleStatus,
      operationalMode: "demo",
    });
    assert.equal(capabilities.lifecycleStatus, lifecycleStatus);
    assert.equal(capabilities.informationalPage, false);
    assert.equal(capabilities.createAppointment, false);
    assert.equal(capabilities.classificationAdmin, true);
  }
});

test("[behavioral] safe demo appointment mode requires the complete fail-closed capability set", () => {
  const safe = resolveTenantOperationalCapabilities({
    lifecycleStatus: "active",
    operationalMode: "demo",
  });
  assert.equal(safe.demoSimulation, true);
  assert.equal(safe.createAppointment, true);
  assert.equal(safe.appointmentOperationalCommunication, true);
  assert.equal(isSafeDemoAppointmentMode(safe), true);
  assert.equal(canRunAppointmentOperationalEffects(safe), true);

  const dangerousCapabilities = [
    "createPayment", "confirmTransfer", "acceptPaymentWebhook",
    "sendExternalEmail", "sendCampaign", "callExternalAutomation",
    "enqueueDte", "manualDteEnqueue", "runDteWorker",
    "publicTaxDocument", "taxAdministration", "dteCertification",
  ];
  for (const capability of dangerousCapabilities) {
    assert.equal(
      isSafeDemoAppointmentMode({ ...safe, [capability]: true }),
      false,
      capability,
    );
    assert.equal(
      canRunAppointmentOperationalEffects({ ...safe, [capability]: true }),
      false,
      `operational effect drift: ${capability}`,
    );
  }
  assert.equal(isSafeDemoAppointmentMode({ ...safe, demoSimulation: false }), false);
  assert.equal(isSafeDemoAppointmentMode({ ...safe, createAppointment: false }), false);
  assert.equal(
    isSafeDemoAppointmentMode({ ...safe, appointmentOperationalCommunication: false }),
    false,
  );
  assert.equal(isSafeDemoAppointmentMode({ ...safe, lifecycleStatus: "archived" }), false);
  assert.equal(
    isSafeDemoAppointmentMode(resolveTenantOperationalCapabilities({
      lifecycleStatus: "active",
      operationalMode: "live",
    })),
    false,
  );
  assert.equal(
    isSafeDemoAppointmentMode(resolveTenantOperationalCapabilities({
      lifecycleStatus: "suspended",
      operationalMode: "demo",
    })),
    false,
  );
  assert.equal(isSafeDemoAppointmentMode({}), false);
  assert.equal(isSafeDemoAppointmentMode(null), false);
  assert.equal(isSafeDemoAppointmentMode(undefined), false);
  assert.equal(canRunAppointmentOperationalEffects({}), false);
  assert.equal(canRunAppointmentOperationalEffects(null), false);
  assert.equal(canRunAppointmentOperationalEffects(undefined), false);

  const live = resolveTenantOperationalCapabilities({
    lifecycleStatus: "active",
    operationalMode: "live",
  });
  assert.equal(canRunAppointmentOperationalEffects(live), true);
  assert.equal(
    canRunAppointmentOperationalEffects({
      ...live,
      appointmentOperationalCommunication: false,
    }),
    false,
  );
});

test("[structural] central guards cover external effects, platform classification and type 39 remains gated", () => {
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
