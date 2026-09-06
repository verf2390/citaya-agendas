import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import {
  safePaymentAuditMetadata,
  verifyMercadoPagoPayment,
} from "../../lib/security/payment-verification.mjs";

const route = readFileSync(
  "app/api/admin/payments/mercadopago/confirm/route.ts",
  "utf8",
);
const appointmentsRangeRoute = readFileSync(
  "app/api/admin/appointments/range/route.ts",
  "utf8",
);
const webhook = readFileSync(
  "app/api/webhooks/mercadopago/route.ts",
  "utf8",
);
const page = readFileSync("app/admin/pagos/page.tsx", "utf8");
const migration = readFileSync(
  "migrations/202609050002_cit66_manual_mercadopago_verification.sql",
  "utf8",
);

const intent = {
  id: "11111111-1111-4111-8111-111111111111",
  amount: 18500,
  currency: "CLP",
};
const payment = {
  id: 987654321,
  transaction_amount: 18500,
  currency_id: "CLP",
  external_reference: intent.id,
  status: "approved",
  date_approved: "2026-09-05T12:00:00Z",
};
const CONFIRMABLE_STATUSES_FOR_TEST = [
  "pending",
  "processing",
  "succeeded",
  "reconciliation_required",
];

const require = createRequire(import.meta.url);
const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const routePath = resolve(
  repoRoot,
  "app/api/admin/payments/mercadopago/confirm/route.ts",
);
const appointmentsRangeRoutePath = resolve(
  repoRoot,
  "app/api/admin/appointments/range/route.ts",
);
const nextServerPath = require.resolve("next/server");
const requireAdminPath = resolve(repoRoot, "lib/api/requireTenantAdmin.ts");
const validatorsPath = resolve(repoRoot, "lib/api/validators.ts");
const verificationPath = resolve(
  repoRoot,
  "lib/security/payment-verification.mjs",
);
const supabasePath = resolve(repoRoot, "lib/supabaseAdmin.ts");
const operationalPath = resolve(repoRoot, "lib/tenant/operational-server.ts");
const notificationPath = resolve(
  repoRoot,
  "services/automations/notify-payment-confirmed.ts",
);
const automaticDtePath = resolve(repoRoot, "services/payments/automatic-dte.ts");
const mercadoPagoPath = resolve(repoRoot, "services/payments/mercadopago.ts");
const paymentConfigPath = resolve(repoRoot, "services/payments/payment-config.ts");
const originalResolve = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = resolve(repoRoot, request.slice(2));
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = (module, filename) => {
  const typescript = require("typescript");
  const output = typescript.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

function installMock(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

async function runAdminConfirmationScenario({
  appointmentId,
  payment: mercadoPagoPayment,
  intents,
}) {
  const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const actorId = "99999999-9999-4999-8999-999999999999";
  const events = [];
  const queries = [];
  const rpcCalls = [];

  class TenantOperationalError extends Error {}

  installMock(nextServerPath, {
    NextResponse: {
      json(body, options = {}) {
        return { body, status: options.status ?? 200 };
      },
    },
  });
  installMock(requireAdminPath, {
    requireHostTenantAdmin: async () => {
      events.push("auth");
      return { ok: true, tenantId, userId: actorId };
    },
  });
  installMock(validatorsPath, {
    isUuid: (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value),
      ),
  });
  installMock(verificationPath, {
    safePaymentAuditMetadata,
    verifyMercadoPagoPayment,
  });
  installMock(operationalPath, {
    TenantOperationalError,
    assertTenantCanVerifyProviderPayment: async (requestedTenantId) => {
      assert.equal(requestedTenantId, tenantId);
      events.push("gate");
      return { capabilities: { sendExternalEmail: false } };
    },
  });
  installMock(paymentConfigPath, {
    getTenantPaymentConfig: async (requestedTenantId) => {
      assert.equal(requestedTenantId, tenantId);
      events.push("config");
      return { accessToken: "tenant-access-token" };
    },
  });
  installMock(mercadoPagoPath, {
    fetchMercadoPagoPayment: async ({ accessToken, paymentId }) => {
      assert.equal(accessToken, "tenant-access-token");
      assert.equal(paymentId, "987654321");
      events.push("fetch");
      return mercadoPagoPayment;
    },
  });
  installMock(notificationPath, {
    notifyPaymentConfirmed: async () => events.push("notify"),
  });
  installMock(automaticDtePath, {
    enqueueAutomaticDteBestEffort: async (intentId) => {
      events.push(`enqueue:${intentId}`);
    },
  });
  installMock(supabasePath, {
    supabaseAdmin: {
      from(table) {
        assert.equal(table, "payment_intents");
        const query = { eq: {}, in: {} };
        queries.push(query);
        const builder = {
          select() {
            return builder;
          },
          eq(column, value) {
            query.eq[column] = value;
            return builder;
          },
          in(column, values) {
            query.in[column] = values;
            return builder;
          },
          maybeSingle() {
            return builder;
          },
          then(onFulfilled, onRejected) {
            events.push("query");
            const rows = intents.filter((row) =>
              Object.entries(query.eq).every(
                ([column, value]) => String(row[column]) === String(value),
              ) && Object.entries(query.in).every(
                ([column, values]) => values.includes(row[column]),
              ),
            );
            return Promise.resolve({
              data: rows.length === 1 ? rows[0] : null,
              error: rows.length > 1 ? { code: "PGRST116" } : null,
            }).then(onFulfilled, onRejected);
          },
        };
        return builder;
      },
      async rpc(name, args) {
        events.push("rpc");
        rpcCalls.push({ name, args });
        return { data: "transitioned", error: null };
      },
    },
  });

  delete require.cache[routePath];
  const { POST } = require(routePath);
  const response = await POST({
    json: async () => ({ appointmentId, paymentId: "987654321" }),
  });
  return { actorId, events, queries, response, rpcCalls, tenantId };
}

async function runAppointmentsRangeScenario({
  appointments,
  intents,
  intentErrorAtQuery = null,
}) {
  const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const queries = [];
  let intentQueryCount = 0;

  installMock(nextServerPath, {
    NextResponse: {
      json(body, options = {}) {
        return { body, status: options.status ?? 200 };
      },
    },
  });
  installMock(requireAdminPath, {
    requireTenantAdmin: async ({ tenantId: requestedTenantId }) => {
      assert.equal(requestedTenantId, tenantId);
      return { ok: true, tenantId, userId: "admin-a" };
    },
  });
  installMock(supabasePath, {
    supabaseAdmin: {
      from(table) {
        const query = { table, eq: {}, in: {} };
        queries.push(query);
        const builder = {
          select() {
            return builder;
          },
          eq(column, value) {
            query.eq[column] = value;
            return builder;
          },
          in(column, values) {
            query.in[column] = values;
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          gte() {
            return builder;
          },
          lt() {
            return builder;
          },
          then(onFulfilled, onRejected) {
            if (table === "payment_intents") {
              intentQueryCount += 1;
              if (intentQueryCount === intentErrorAtQuery) {
                return Promise.resolve({
                  data: null,
                  error: { code: "TEST_CHUNK_FAILURE" },
                }).then(onFulfilled, onRejected);
              }
            }
            const source = table === "appointments" ? appointments : intents;
            const rows = source.filter((row) =>
              Object.entries(query.eq).every(
                ([column, value]) => String(row[column]) === String(value),
              ) && Object.entries(query.in).every(
                ([column, values]) => values.includes(row[column]),
              ),
            );
            return Promise.resolve({ data: rows, error: null }).then(
              onFulfilled,
              onRejected,
            );
          },
        };
        return builder;
      },
    },
  });

  delete require.cache[appointmentsRangeRoutePath];
  const { GET } = require(appointmentsRangeRoutePath);
  const response = await GET(
    new Request(
      `https://tenant-a.citaya.local/api/admin/appointments/range?tenantId=${tenantId}&start=2026-09-01T00:00:00.000Z&end=2026-10-01T00:00:00.000Z`,
    ),
  );
  return { queries, response, tenantId };
}

test.after(() => {
  Module._resolveFilename = originalResolve;
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
  for (const modulePath of [
    routePath,
    appointmentsRangeRoutePath,
    nextServerPath,
    requireAdminPath,
    validatorsPath,
    verificationPath,
    supabasePath,
    operationalPath,
    notificationPath,
    automaticDtePath,
    mercadoPagoPath,
    paymentConfigPath,
  ]) {
    delete require.cache[modulePath];
  }
});

test("CIT-66 verifies every Mercado Pago binding before finalization", () => {
  assert.deepEqual(verifyMercadoPagoPayment(intent, payment, "987654321"), {
    ok: true,
  });
  for (const [field, changed, reason] of [
    ["id", 123, "payment_id_mismatch"],
    ["transaction_amount", 1, "amount_mismatch"],
    ["currency_id", "USD", "currency_mismatch"],
    ["external_reference", "other-intent", "external_reference_mismatch"],
    ["status", "pending", "not_approved"],
  ]) {
    assert.equal(
      verifyMercadoPagoPayment(
        intent,
        { ...payment, [field]: changed },
        "987654321",
      ).reason,
      reason,
      field,
    );
  }
});

test("CIT-66 keeps only minimal Mercado Pago verification evidence", () => {
  const safe = safePaymentAuditMetadata("mercadopago", {
    ...payment,
    payer: { email: "private@example.invalid" },
    card: { last_four_digits: "1234" },
  });
  assert.deepEqual(safe, {
    payment_id: "987654321",
    status: "approved",
    date_approved: "2026-09-05T12:00:00Z",
    transaction_amount: 18500,
    currency_id: "CLP",
    external_reference: intent.id,
  });
  assert.doesNotMatch(JSON.stringify(safe), /private|1234/);
});

test("CIT-66 admin route is host-tenant bound and verifies MP before its RPC", () => {
  assert.match(route, /requireHostTenantAdmin\(req\)/);
  assert.match(route, /assertTenantCanVerifyProviderPayment\(access\.tenantId\)/);
  assert.doesNotMatch(route, /assertTenantCanConfirmTransfer/);
  assert.match(route, /externalReference = String\(payment\.external_reference \?\? ""\)\.trim\(\)/);
  assert.match(route, /if \(!isUuid\(externalReference\)\)/);
  assert.match(route, /\.eq\("id", externalReference\)/);
  assert.match(route, /\.eq\("tenant_id", access\.tenantId\)/);
  assert.match(route, /\.eq\("appointment_id", appointmentId\)/);
  assert.match(route, /\.eq\("provider", "mercadopago"\)/);
  assert.match(route, /\.in\("status", CONFIRMABLE_STATUSES\)/);
  assert.match(route, /\.maybeSingle\(\)/);
  assert.doesNotMatch(route, /candidates|\.limit\(2\)/);
  assert.doesNotMatch(route, /input\?\.tenantId|input\.tenantId/);
  assert.match(route, /getTenantPaymentConfig\(access\.tenantId\)/);

  const authIndex = route.indexOf("requireHostTenantAdmin(req)");
  const gateIndex = route.indexOf(
    "assertTenantCanVerifyProviderPayment(access.tenantId)",
  );
  const configIndex = route.lastIndexOf("getTenantPaymentConfig(access.tenantId)");
  const fetchIndex = route.lastIndexOf("fetchMercadoPagoPayment");
  const intentIndex = route.indexOf('.from("payment_intents")');
  const verifyIndex = route.lastIndexOf("verifyMercadoPagoPayment");
  const rpcIndex = route.indexOf(
    '"billing_confirm_manually_verified_mercadopago_payment"',
  );
  assert.ok(authIndex >= 0);
  assert.ok(gateIndex > authIndex);
  assert.ok(configIndex > gateIndex);
  assert.ok(fetchIndex > configIndex);
  assert.ok(intentIndex > fetchIndex);
  assert.ok(verifyIndex > fetchIndex);
  assert.ok(rpcIndex > verifyIndex);
  assert.match(
    route,
    /receivedAmount = Number\(payment\.transaction_amount\)[\s\S]*Number\.isFinite\(receivedAmount\)[\s\S]*receivedAmount <= 0/,
  );
  assert.match(route, /verification_source: "admin_mercadopago_lookup"/);
  assert.match(route, /p_actor_id: access\.userId/);
  assert.match(route, /p_preference_id: preferenceId/);
  assert.match(route, /p_mercadopago_payment_id: paymentId/);
  assert.match(route, /enqueueAutomaticDteBestEffort\(intent\.id\)/);
  assert.match(webhook, /verifyMercadoPagoPayment\(intent, payment, paymentId\)/);
});

test("CIT-66 selects the exact server-side external reference and rejects scope mismatches", async () => {
  const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const appointmentA = "11111111-1111-4111-8111-111111111111";
  const appointmentOther = "22222222-2222-4222-8222-222222222222";
  const succeededIntentId = "33333333-3333-4333-8333-333333333333";
  const pendingIntentId = "44444444-4444-4444-8444-444444444444";
  const tenantBIntentId = "55555555-5555-4555-8555-555555555555";
  const otherAppointmentIntentId = "66666666-6666-4666-8666-666666666666";
  const makeIntent = ({
    id,
    tenant_id = tenantA,
    appointment_id = appointmentA,
    status = "pending",
  }) => ({
    id,
    tenant_id,
    appointment_id,
    provider: "mercadopago",
    provider_payment_id: `preference-${id}`,
    verified_provider_payment_id: null,
    amount: 18500,
    currency: "CLP",
    status,
    audit_metadata: {},
  });

  const twoTranches = [
    makeIntent({ id: succeededIntentId, status: "succeeded" }),
    makeIntent({ id: pendingIntentId }),
  ];
  const selected = await runAdminConfirmationScenario({
    appointmentId: appointmentA,
    payment: { ...payment, external_reference: pendingIntentId },
    intents: twoTranches,
  });
  assert.equal(selected.response.status, 200);
  assert.equal(selected.response.body.paymentIntentId, pendingIntentId);
  assert.equal(selected.rpcCalls.length, 1);
  assert.equal(selected.rpcCalls[0].args.p_intent_id, pendingIntentId);
  assert.deepEqual(selected.events.slice(0, 6), [
    "auth",
    "gate",
    "config",
    "fetch",
    "query",
    "rpc",
  ]);
  assert.deepEqual(selected.queries[0].eq, {
    id: pendingIntentId,
    tenant_id: tenantA,
    appointment_id: appointmentA,
    provider: "mercadopago",
  });
  assert.deepEqual(selected.queries[0].in.status, CONFIRMABLE_STATUSES_FOR_TEST);

  for (const scenario of [
    {
      name: "cross-tenant",
      paymentReference: tenantBIntentId,
      intents: [makeIntent({ id: tenantBIntentId, tenant_id: tenantB })],
    },
    {
      name: "other-appointment",
      paymentReference: otherAppointmentIntentId,
      intents: [
        makeIntent({
          id: otherAppointmentIntentId,
          appointment_id: appointmentOther,
        }),
      ],
    },
  ]) {
    const result = await runAdminConfirmationScenario({
      appointmentId: appointmentA,
      payment: { ...payment, external_reference: scenario.paymentReference },
      intents: scenario.intents,
    });
    assert.equal(result.response.status, 409, scenario.name);
    assert.equal(result.rpcCalls.length, 0, scenario.name);
  }

  const invalidReference = await runAdminConfirmationScenario({
    appointmentId: appointmentA,
    payment: { ...payment, external_reference: "not-a-uuid" },
    intents: twoTranches,
  });
  assert.equal(invalidReference.response.status, 409);
  assert.equal(invalidReference.queries.length, 0);
  assert.equal(invalidReference.rpcCalls.length, 0);

  for (const transactionAmount of ["not-a-number", 0]) {
    const invalidAmount = await runAdminConfirmationScenario({
      appointmentId: appointmentA,
      payment: {
        ...payment,
        external_reference: pendingIntentId,
        transaction_amount: transactionAmount,
      },
      intents: twoTranches,
    });
    assert.equal(invalidAmount.response.status, 409, String(transactionAmount));
    assert.equal(invalidAmount.queries.length, 0, String(transactionAmount));
    assert.equal(invalidAmount.rpcCalls.length, 0, String(transactionAmount));
  }
});

test("CIT-66 preserves preference and reuses the existing financial/DTE pipeline", () => {
  assert.match(migration, /add column verified_provider_payment_id text/);
  assert.match(
    migration,
    /unique index payment_intents_verified_provider_payment_uidx[\s\S]*tenant_id,\s*provider,\s*verified_provider_payment_id/,
  );
  assert.match(
    migration,
    /where id = p_intent_id\s+and tenant_id = p_tenant_id\s+and appointment_id = p_appointment_id\s+and provider = 'mercadopago'\s+for update/,
  );
  assert.match(
    migration,
    /intent_row\.provider_payment_id is distinct from p_preference_id/,
  );
  assert.match(
    migration,
    /public\.finalize_verified_payment\([\s\S]*intent_row\.provider_payment_id/,
  );
  assert.match(
    migration,
    /public\.billing_record_unapplied_provider_payment\(/,
  );
  const replayBranch = migration.match(
    /if intent_row\.status in \('succeeded','reconciliation_required'\) then([\s\S]*?)return case/,
  )?.[1];
  assert.ok(replayBranch);
  assert.match(
    replayBranch,
    /set verified_provider_payment_id = p_mercadopago_payment_id/,
  );
  assert.doesNotMatch(
    replayBranch,
    /audit_metadata\s*=|verified_by\s*=|verified_at\s*=|evidence_sha256\s*=|public\.payments/,
  );
  assert.doesNotMatch(migration, /create or replace function public\.dte_enqueue_payment_snapshot/);
  assert.doesNotMatch(migration, /caf|reserve_folio|submit.*sii/i);
});

test("CIT-66 exposes confirmable Mercado Pago intents through the tenant-scoped admin range", async () => {
  const appointmentId = "11111111-1111-4111-8111-111111111166";
  const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const appointment = (paymentStatus, paymentProvider = "mercadopago") => ({
    id: appointmentId,
    tenant_id: tenantA,
    payment_status: paymentStatus,
    payment_provider: paymentProvider,
  });
  const intent = (tenantId, status) => ({
    appointment_id: appointmentId,
    tenant_id: tenantId,
    provider: "mercadopago",
    status,
  });

  const scenarios = [
    {
      name: "partial payment with pending MP balance",
      appointments: [appointment("partially_paid")],
      intents: [intent(tenantA, "succeeded"), intent(tenantA, "pending")],
      expected: true,
    },
    {
      name: "aggregate MP provider without confirmable MP intent",
      appointments: [appointment("partially_paid")],
      intents: [intent(tenantA, "succeeded")],
      expected: false,
    },
    {
      name: "tenant B pending intent",
      appointments: [appointment("partially_paid")],
      intents: [intent(tenantB, "pending")],
      expected: false,
    },
    {
      name: "fully paid appointment",
      appointments: [appointment("paid")],
      intents: [intent(tenantA, "pending")],
      expected: false,
    },
  ];

  for (const scenario of scenarios) {
    const result = await runAppointmentsRangeScenario(scenario);
    assert.equal(result.response.status, 200, scenario.name);
    assert.equal(
      result.response.body.items[0].hasConfirmableMercadoPagoIntent,
      scenario.expected,
      scenario.name,
    );
    const intentQuery = result.queries.find(
      (query) => query.table === "payment_intents",
    );
    assert.equal(intentQuery.eq.tenant_id, tenantA, scenario.name);
    assert.equal(intentQuery.eq.provider, "mercadopago", scenario.name);
    assert.deepEqual(
      intentQuery.in.status,
      ["pending", "processing"],
      scenario.name,
    );
    assert.deepEqual(intentQuery.in.appointment_id, [appointmentId], scenario.name);
  }

  assert.match(appointmentsRangeRoute, /requireTenantAdmin\(\{ req, tenantId \}\)/);
  const intentLookup = appointmentsRangeRoute.match(
    /\.from\("payment_intents"\)([\s\S]*?)if \(confirmableIntentsError\)/,
  )?.[1];
  assert.ok(intentLookup);
  assert.match(intentLookup, /\.select\("appointment_id"\)/);
  assert.match(intentLookup, /\.eq\("tenant_id", access\.tenantId\)/);
  assert.match(intentLookup, /\.in\("appointment_id", appointmentIdChunk\)/);
  assert.doesNotMatch(
    intentLookup,
    /provider_payment_id|verified_provider_payment_id|audit_metadata/,
  );
});

test("CIT-66 chunks tenant-scoped appointment intent lookups and fails closed", async () => {
  const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const appointmentId = (index) =>
    `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
  const appointments = Array.from({ length: 101 }, (_, index) => ({
    id: appointmentId(index + 1),
    tenant_id: tenantA,
    payment_status: "pending",
    payment_provider: "mercadopago",
  }));
  const intents = [
    {
      appointment_id: appointmentId(1),
      tenant_id: tenantA,
      provider: "mercadopago",
      status: "pending",
    },
    {
      appointment_id: appointmentId(101),
      tenant_id: tenantA,
      provider: "mercadopago",
      status: "processing",
    },
    {
      appointment_id: appointmentId(50),
      tenant_id: tenantB,
      provider: "mercadopago",
      status: "pending",
    },
  ];

  const result = await runAppointmentsRangeScenario({ appointments, intents });
  assert.equal(result.response.status, 200);
  assert.equal(
    result.response.body.items[0].hasConfirmableMercadoPagoIntent,
    true,
  );
  assert.equal(
    result.response.body.items[100].hasConfirmableMercadoPagoIntent,
    true,
  );
  assert.equal(
    result.response.body.items[49].hasConfirmableMercadoPagoIntent,
    false,
  );

  const intentQueries = result.queries.filter(
    (query) => query.table === "payment_intents",
  );
  assert.equal(intentQueries.length, 2);
  assert.deepEqual(
    intentQueries.map((query) => query.in.appointment_id.length),
    [100, 1],
  );
  for (const query of intentQueries) {
    assert.equal(query.eq.tenant_id, tenantA);
    assert.equal(query.eq.provider, "mercadopago");
    assert.deepEqual(query.in.status, ["pending", "processing"]);
  }

  const failed = await runAppointmentsRangeScenario({
    appointments,
    intents,
    intentErrorAtQuery: 2,
  });
  assert.equal(failed.response.status, 500);
  assert.deepEqual(failed.response.body, {
    error: "No se pudo revisar el estado de los pagos",
  });
});

test("CIT-66 UI exposes a provider-specific pending action and safe replay UX", () => {
  const predicate = page.match(
    /function isPendingMercadoPagoPayment\(row: AppointmentPayment\) \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(predicate);
  assert.match(
    predicate,
    /row\.hasConfirmableMercadoPagoIntent === true/,
  );
  assert.match(predicate, /normalizedStatus\(row\.payment_status\) !== "paid"/);
  assert.doesNotMatch(predicate, /payment_provider/);
  assert.match(page, /Verificar pago en Mercado Pago/);
  assert.match(page, /Citaya consultará Mercado Pago antes de confirmar el pago\./);
  assert.match(page, /Ingresa el ID real del pago de Mercado Pago\./);
  assert.match(page, /Verificando en Mercado Pago\.\.\./);
  assert.match(page, /json\.replay[\s\S]*El pago ya estaba confirmado/);
  const verifyAction = page.match(
    /const verifyMercadoPagoPayment = async[\s\S]*?const copyPaymentLink = async/,
  )?.[0];
  assert.ok(verifyAction);
  assert.match(
    verifyAction,
    /catch \{[\s\S]*title: "No se pudo verificar el pago"[\s\S]*description: "No fue posible consultar Mercado Pago\. Intenta nuevamente\."[\s\S]*variant: "destructive"/,
  );
  assert.match(
    verifyAction,
    /refreshAppointmentDocumentContext\(appointmentId\)[\s\S]*await loadRows\(\)/,
  );
  assert.match(
    page,
    /normalizedStatus\(row\.payment_provider\) === "manual" && isPendingPayment\(row\)/,
  );
  assert.doesNotMatch(
    page,
    /JSON\.stringify\(\{ appointmentId, paymentId, tenantId/,
  );
});
