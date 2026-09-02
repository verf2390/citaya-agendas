import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canRunAppointmentOperationalEffects,
  resolveTenantOperationalCapabilities,
} from "../../lib/tenant/operational-mode.mjs";
import {
  dispatchAppointmentCanceledEvent,
  dispatchAppointmentCreatedEvent,
  dispatchAppointmentRescheduledEvent,
  runPostPersistedAppointmentEffect,
  shouldDispatchAppointmentCreatedEvent,
} from "../../services/automations/appointment-events.mjs";

test("[behavioral] appointment operational effects allow live and fail-closed safe demo", () => {
  const demo = resolveTenantOperationalCapabilities({
    lifecycleStatus: "active",
    operationalMode: "demo",
  });
  const live = resolveTenantOperationalCapabilities({
    lifecycleStatus: "active",
    operationalMode: "live",
  });
  assert.equal(canRunAppointmentOperationalEffects(demo), true);
  assert.equal(canRunAppointmentOperationalEffects(live), true);
  assert.equal(
    canRunAppointmentOperationalEffects({
      ...live,
      operationalMode: "unknown",
    }),
    false,
  );

  const dangerousCapabilities = [
    "createPayment",
    "confirmTransfer",
    "acceptPaymentWebhook",
    "sendExternalEmail",
    "sendCampaign",
    "callExternalAutomation",
    "enqueueDte",
    "manualDteEnqueue",
    "runDteWorker",
    "publicTaxDocument",
    "taxAdministration",
    "dteCertification",
  ];
  for (const capability of dangerousCapabilities) {
    assert.equal(demo[capability], false, `safe demo matrix: ${capability}`);
    assert.equal(
      canRunAppointmentOperationalEffects({ ...demo, [capability]: true }),
      false,
      capability,
    );
  }
  assert.equal(
    canRunAppointmentOperationalEffects({
      ...demo,
      appointmentOperationalCommunication: false,
    }),
    false,
  );
});

test("[behavioral] duplicate appointment creation never dispatches confirmation", () => {
  const demo = resolveTenantOperationalCapabilities({
    lifecycleStatus: "active",
    operationalMode: "demo",
  });
  assert.equal(shouldDispatchAppointmentCreatedEvent(demo, false), true);
  assert.equal(shouldDispatchAppointmentCreatedEvent(demo, true), false);
  assert.equal(shouldDispatchAppointmentCreatedEvent(demo, null), false);
  assert.equal(shouldDispatchAppointmentCreatedEvent(demo, undefined), false);
  assert.equal(shouldDispatchAppointmentCreatedEvent(demo, "false"), false);
  assert.equal(shouldDispatchAppointmentCreatedEvent(demo, 0), false);
  assert.equal(
    shouldDispatchAppointmentCreatedEvent({
      ...demo,
      appointmentOperationalCommunication: false,
    }, false),
    false,
  );
});

test("[behavioral] confirmation uses header auth and the fresh manage token", async () => {
  const calls = [];
  const result = await dispatchAppointmentCreatedEvent(
    {
      appointmentId: "appointment-demo",
      manageToken: "fresh-manage-token",
      publicBaseUrl: "https://tenant.example.invalid",
    },
    {
      webhookUrl: "https://n8n.example.invalid/webhook/confirmation",
      webhookSecret: "test-secret",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200 };
      },
    },
  );

  assert.deepEqual(result, { called: true, ok: true, status: 200, reason: null });
  assert.equal(calls.length, 1);
  const target = new URL(calls[0].url);
  assert.equal(target.searchParams.has("secret"), false);
  assert.equal(calls[0].init.headers["x-citaya-secret"], "test-secret");
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.appointment_id, "appointment-demo");
  assert.equal(payload.manage_token, "fresh-manage-token");
  assert.equal("recipient" in payload, false);
  assert.equal("customer_email" in payload, false);
  assert.equal("customer_phone" in payload, false);
  assert.equal(
    payload.manage_url,
    "https://tenant.example.invalid/reservar/gestionar?token=fresh-manage-token",
  );
});

test("[behavioral] webhook failures are returned as data instead of throwing", async () => {
  const common = {
    appointmentId: "appointment-demo",
    manageToken: "fresh-manage-token",
    publicBaseUrl: "https://tenant.example.invalid",
  };
  const configured = {
    webhookUrl: "https://n8n.example.invalid/webhook/confirmation",
    webhookSecret: "test-secret",
  };

  const network = await dispatchAppointmentCreatedEvent(common, {
    ...configured,
    fetchImpl: async () => { throw new Error("network unavailable"); },
  });
  assert.equal(network.called, true);
  assert.equal(network.ok, false);

  const rejected = await dispatchAppointmentCreatedEvent(common, {
    ...configured,
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  assert.deepEqual(rejected, {
    called: true,
    ok: false,
    status: 500,
    reason: "webhook_rejected",
  });

  const timeout = await dispatchAppointmentCreatedEvent(common, {
    ...configured,
    timeoutMs: 1,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  });
  assert.equal(timeout.called, true);
  assert.equal(timeout.ok, false);
  assert.equal(timeout.reason, "AbortError");
});

test("[behavioral] an unexpected post-persistence effect failure never rejects the booking flow", async () => {
  const result = await runPostPersistedAppointmentEffect(async () => {
    throw new TypeError("unexpected dispatcher failure");
  });
  assert.deepEqual(result, {
    called: false,
    ok: false,
    status: 0,
    reason: "TypeError",
  });
});

test("[behavioral] cancel and reschedule dispatchers use authenticated appointment-scoped contracts", async () => {
  const calls = [];
  const options = {
    webhookUrl: "https://n8n.example.invalid/webhook/appointment-event",
    webhookSecret: "test-secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202 };
    },
  };

  await dispatchAppointmentCanceledEvent({
    appointmentId: "appointment-demo",
    tenantId: "tenant-demo",
    source: "manage_token",
  }, options);
  await dispatchAppointmentRescheduledEvent({
    appointmentId: "appointment-demo",
    tenantId: "tenant-demo",
    oldStartAt: "2026-08-20T12:00:00.000Z",
    oldEndAt: "2026-08-20T13:00:00.000Z",
    newStartAt: "2026-08-21T12:00:00.000Z",
    newEndAt: "2026-08-21T13:00:00.000Z",
    manageToken: "rotated-manage-token",
    source: "manage_token",
  }, options);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.headers["x-citaya-secret"], "test-secret");
    assert.equal(new URL(call.url).searchParams.has("secret"), false);
    const payload = JSON.parse(call.init.body);
    assert.equal("recipient" in payload, false);
    assert.equal("customer_email" in payload, false);
    assert.equal("customer_phone" in payload, false);
  }
  assert.equal(JSON.parse(calls[1].init.body).manage_token, "rotated-manage-token");
});

test("[behavioral] cancel and reschedule webhook failures remain best-effort", async () => {
  const networkFailure = {
    webhookUrl: "https://n8n.example.invalid/webhook/appointment-event",
    webhookSecret: "test-secret",
    fetchImpl: async () => { throw new Error("network unavailable"); },
  };
  const cancel = await dispatchAppointmentCanceledEvent({
    appointmentId: "appointment-demo",
    tenantId: "tenant-demo",
    source: "manage_token",
  }, networkFailure);
  assert.equal(cancel.called, true);
  assert.equal(cancel.ok, false);

  const reschedule = await dispatchAppointmentRescheduledEvent({
    appointmentId: "appointment-demo",
    tenantId: "tenant-demo",
    oldStartAt: "2026-08-20T12:00:00.000Z",
    oldEndAt: "2026-08-20T13:00:00.000Z",
    newStartAt: "2026-08-21T12:00:00.000Z",
    newEndAt: "2026-08-21T13:00:00.000Z",
    manageToken: "rotated-manage-token",
    source: "manage_token",
  }, {
    ...networkFailure,
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  assert.deepEqual(reschedule, {
    called: true,
    ok: false,
    status: 500,
    reason: "webhook_rejected",
  });
});

test("[structural] appointment effects are capability-gated and rotated token replaces the old URL", () => {
  const createRoute = readFileSync("app/api/appointments/create/route.ts", "utf8");
  const cancelRoute = readFileSync("app/api/appointments/cancel/route.ts", "utf8");
  const rescheduleRoute = readFileSync("app/api/appointments/reschedule/route.ts", "utf8");
  const adminCancelRoute = readFileSync("app/api/appointments/cancel-by-id/route.ts", "utf8");
  const adminRescheduleRoute = readFileSync("app/api/appointments/reschedule-by-id/route.ts", "utf8");
  const managePage = readFileSync("app/reservar/gestionar/page.tsx", "utf8");

  assert.match(createRoute, /shouldDispatchAppointmentCreatedEvent\([\s\S]*row\.duplicate,/);
  assert.match(createRoute, /runPostPersistedAppointmentEffect\([\s\S]*dispatchAppointmentCreatedEvent/);
  assert.match(
    createRoute,
    /if \(isAdminRequest\) \{[\s\S]*publicTenantSlug = operational\.tenantSlug \|\| null;/,
  );
  assert.match(
    createRoute,
    /publicTenantBaseUrl\(req, publicTenantSlug\) \?\?[\s\S]*getTenantPublicBaseUrl\(publicTenantSlug\)/,
  );
  assert.match(cancelRoute, /assertTenantCanRunAppointmentOperationalEffects[\s\S]*dispatchAppointmentCanceledEvent/);
  assert.match(rescheduleRoute, /assertTenantCanRunAppointmentOperationalEffects[\s\S]*dispatchAppointmentRescheduledEvent/);
  assert.match(adminCancelRoute, /appointmentCommunicationAllowed[\s\S]*assertTenantCanRunAppointmentOperationalEffects/);
  assert.match(adminRescheduleRoute, /appointmentCommunicationAllowed[\s\S]*assertTenantCanRunAppointmentOperationalEffects/);
  assert.match(managePage, /rotatedManageToken[\s\S]*setManageToken\(rotatedManageToken\)/);
  assert.match(managePage, /history\.replaceState[\s\S]*citaya_manage_token:/);
});

test("[structural] rotated and created manage tokens remain hash-only in appointment persistence", () => {
  const createRoute = readFileSync("app/api/appointments/create/route.ts", "utf8");
  const rescheduleRoute = readFileSync("app/api/appointments/reschedule/route.ts", "utf8");
  const plaintextRemoval = readFileSync(
    "migrations/202608070001_remove_legacy_manage_tokens.sql",
    "utf8",
  );

  assert.match(createRoute, /p_manage_token_hash: hashManageToken\(manageToken, pepper\)/);
  assert.doesNotMatch(createRoute, /p_manage_token:\s*manageToken/);
  assert.match(rescheduleRoute, /manage_token:\s*null/);
  assert.match(rescheduleRoute, /manage_token_hash:\s*hashManageToken\(nextToken, pepper\)/);
  assert.doesNotMatch(rescheduleRoute, /manage_token:\s*nextToken/);
  assert.match(plaintextRemoval, /check \(manage_token is null\)/);
});

test("[structural] dispatchers cannot accept a caller-provided recipient", () => {
  const dispatcher = readFileSync("services/automations/appointment-events.mjs", "utf8");
  const declarations = readFileSync("services/automations/appointment-events.d.ts", "utf8");
  assert.doesNotMatch(dispatcher, /recipient|customerEmail|customerPhone|toEmail/);
  assert.doesNotMatch(declarations, /recipient|customerEmail|customerPhone|toEmail/);
  assert.doesNotMatch(dispatcher, /query\.secret|\?secret=|searchParams\.set\(["']secret/);
  assert.doesNotMatch(dispatcher, /appointments\.manage_token/);
});
