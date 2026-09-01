import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const ts = require("typescript");
const originalResolve = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = resolve(repoRoot, request.slice(2));
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const contextPath = resolve(
  repoRoot,
  "lib/dte/admin-appointment-document-context.ts",
);
const draftRoutePath = resolve(repoRoot, "app/api/admin/invoice-drafts/route.ts");
const supabasePath = resolve(repoRoot, "lib/supabaseAdmin.ts");
const cutoverPath = resolve(repoRoot, "lib/dte/cutover.ts");

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

function queryBuilder(table, resolveQuery) {
  const state = {
    table,
    operation: "select",
    payload: null,
    eq: {},
    in: {},
    neq: {},
  };
  const builder = {
    select() {
      return builder;
    },
    insert(payload) {
      state.operation = "insert";
      state.payload = payload;
      return builder;
    },
    delete() {
      state.operation = "delete";
      return builder;
    },
    eq(column, value) {
      state.eq[column] = value;
      return builder;
    },
    in(column, values) {
      state.in[column] = values;
      return builder;
    },
    neq(column, value) {
      state.neq[column] = value;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    single() {
      return builder;
    },
    maybeSingle() {
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve()
        .then(() => resolveQuery(state))
        .then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function loadContextModule(supabaseAdmin) {
  delete require.cache[contextPath];
  installMock(supabasePath, { supabaseAdmin });
  installMock(cutoverPath, {
    friendlyDteStatus: (status) => String(status ?? ""),
  });
  return require(contextPath);
}

test.after(() => {
  Module._resolveFilename = originalResolve;
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
  for (const modulePath of [
    contextPath,
    draftRoutePath,
    supabasePath,
    cutoverPath,
  ]) {
    delete require.cache[modulePath];
  }
});

test("PAID requested_document_type=33 permite sólo Factura", () => {
  const { appointmentDocumentActionState } = loadContextModule({});
  assert.deepEqual(
    appointmentDocumentActionState({
      requestedDocumentType: 33,
      paymentState: "PAID",
      hasIntent: false,
      hasActiveDraft: false,
      hasActiveCoverage: false,
    }),
    { canRequestBoleta: false, canRequestFactura: true, reason: null },
  );
});

test("PAID requested_document_type=39 permite sólo Boleta", () => {
  const { appointmentDocumentActionState } = loadContextModule({});
  assert.deepEqual(
    appointmentDocumentActionState({
      requestedDocumentType: 39,
      paymentState: "PAID",
      hasIntent: false,
      hasActiveDraft: false,
      hasActiveCoverage: false,
    }),
    { canRequestBoleta: true, canRequestFactura: false, reason: null },
  );
});

test("venta PAID sin tipo permite ambas acciones y conserva fail-closed", () => {
  const { appointmentDocumentActionState } = loadContextModule({});
  assert.deepEqual(
    appointmentDocumentActionState({
      requestedDocumentType: null,
      paymentState: "PAID",
      hasIntent: false,
      hasActiveDraft: false,
      hasActiveCoverage: false,
    }),
    { canRequestBoleta: true, canRequestFactura: true, reason: null },
  );
  for (const blocked of [
    { hasIntent: true },
    { hasActiveDraft: true },
    { hasActiveCoverage: true },
    { paymentState: "UNPAID" },
  ]) {
    const state = appointmentDocumentActionState({
      requestedDocumentType: 33,
      paymentState: "PAID",
      hasIntent: false,
      hasActiveDraft: false,
      hasActiveCoverage: false,
      ...blocked,
    });
    assert.equal(state.canRequestBoleta, false);
    assert.equal(state.canRequestFactura, false);
  }
});

test("sibling appointments de la misma sale detectan el mismo active draft", async () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const appointmentA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const appointmentB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const saleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const draftId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const intentId = "abababab-abab-4aba-8aba-abababababab";
  const queries = [];
  const supabaseAdmin = {
    from(table) {
      return queryBuilder(table, (query) => {
        queries.push(query);
        assert.equal(query.eq.tenant_id, tenantId);
        if (table === "appointments") {
          return {
            data: [
              { id: appointmentA, customer_id: "customer-a" },
              { id: appointmentB, customer_id: "customer-a" },
            ],
            error: null,
          };
        }
        if (table === "billing_sale_appointments") {
          return query.in.appointment_id
            ? {
                data: [
                  { appointment_id: appointmentA, sale_id: saleId },
                  { appointment_id: appointmentB, sale_id: saleId },
                ],
                error: null,
              }
            : {
                data: [
                  { appointment_id: appointmentA, sale_id: saleId },
                  { appointment_id: appointmentB, sale_id: saleId },
                ],
                error: null,
              };
        }
        if (table === "dte_invoice_drafts") {
          assert.deepEqual(query.in.appointment_id, [appointmentA, appointmentB]);
          return {
            data: [
              {
                id: draftId,
                appointment_id: appointmentB,
                intent_id: intentId,
                dte_type: 33,
                status: "DRAFT",
                created_at: "2026-08-31T10:00:00.000Z",
              },
            ],
            error: null,
          };
        }
        if (table === "billing_sales") {
          return {
            data: [
              {
                id: saleId,
                requested_document_type: null,
                document_status: null,
                tax_treatment_status: null,
                payment_state: "PAID",
                total_amount: 119,
                documented_amount: 0,
                pending_documentation_amount: 119,
              },
            ],
            error: null,
          };
        }
        if (
          table === "billing_sale_payments" ||
          table === "billing_sale_item_document_coverage"
        ) {
          return { data: [], error: null };
        }
        if (table === "dte_payment_document_intents") {
          assert.deepEqual(query.in.id, [intentId]);
          return {
            data: [
              {
                id: intentId,
                payment_intent_id: null,
                resolved_dte_type: 33,
                status: "PENDING",
                safe_blocking_reason: null,
                production_document_id: null,
                created_at: "2026-08-31T10:01:00.000Z",
              },
            ],
            error: null,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      });
    },
  };
  const { loadAdminAppointmentDocumentContexts } = loadContextModule(supabaseAdmin);
  const contexts = await loadAdminAppointmentDocumentContexts(tenantId, [
    appointmentA,
    appointmentB,
  ]);

  assert.equal(contexts.length, 2);
  for (const context of contexts) {
    assert.equal(context.saleId, saleId);
    assert.equal(context.activeDraft?.id, draftId);
    assert.equal(context.intent?.id, intentId);
    assert.equal(context.canRequestBoleta, false);
    assert.equal(context.canRequestFactura, false);
    assert.match(context.actionBlockedReason, /proceso tributario/i);
  }
  assert.equal(
    queries.filter((query) => query.table === "dte_invoice_drafts").length,
    1,
  );
});

const customerId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const appointmentId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const canonicalSaleId = "12121212-1212-4121-8121-121212121212";
const browserSaleId = "34343434-3434-4343-8343-343434343434";

function loadDraftRoute({ context, capturedDrafts }) {
  delete require.cache[draftRoutePath];
  const moduleMocks = [
    [
      resolve(repoRoot, "lib/api/requireTenantAdmin.ts"),
      {
        requireHostTenantAdmin: async () => ({
          ok: true,
          tenantId: "11111111-1111-4111-8111-111111111111",
          userId: "56565656-5656-4565-8565-565656565656",
        }),
      },
    ],
    [resolve(repoRoot, "lib/api/validators.ts"), { isUuid: () => true }],
    [
      contextPath,
      { loadAdminAppointmentDocumentContexts: async () => [context] },
    ],
    [
      resolve(repoRoot, "lib/dte/boleta39-manual-gate.ts"),
      { checkManualBoleta39IssuanceReadiness: async () => ({ ready: true }) },
    ],
    [
      resolve(repoRoot, "lib/dte/invoice-drafts.ts"),
      {
        validateInvoiceDraftLines: () => [
          {
            serviceId: null,
            appointmentId: null,
            pricingMode: "manual_net",
            taxTreatment: "affected",
          },
        ],
        calculateDocumentDraftTotals: () => ({
          netAmount: 100,
          taxAmount: 19,
          totalAmount: 119,
          lines: [
            {
              serviceId: null,
              appointmentId: null,
              position: 1,
              description: "Servicio",
              quantity: 1,
              unitNetAmount: 100,
              discountBasisPoints: 0,
              pricingMode: "manual_net",
              catalogUnitGrossAmount: null,
              discountAmount: 0,
              netAmount: 100,
              taxAmount: 19,
              totalAmount: 119,
            },
          ],
        }),
      },
    ],
    [
      require.resolve("next/server"),
      { NextResponse: { json: (body, init) => Response.json(body, init) } },
    ],
  ];
  for (const [modulePath, exports] of moduleMocks) installMock(modulePath, exports);

  let insertedDraft = null;
  const supabaseAdmin = {
    from(table) {
      return queryBuilder(table, (query) => {
        if (table === "customers") {
          return { data: { id: customerId }, error: null };
        }
        if (table === "appointments") {
          return {
            data: context
              ? [
                  {
                    id: appointmentId,
                    customer_id: customerId,
                    payment_status: "paid",
                    payment_paid_amount: 119,
                  },
                ]
              : [],
            error: null,
          };
        }
        if (table === "dte_production_tenant_settings") {
          return {
            data: {
              issuer_rut: "76000000-0",
              issuer_legal_name: "Emisor",
              issuer_activity: "Servicios",
              issuer_address: "Calle 1",
              issuer_commune: "Santiago",
              issuer_city: "Santiago",
            },
            error: null,
          };
        }
        if (table === "customer_tax_profiles") {
          return {
            data: {
              rut_normalized: "11111111-1",
              legal_name: "Cliente",
              business_activity: "Servicios",
              tax_address: "Calle 2",
              tax_commune: "Santiago",
              tax_city: "Santiago",
              tax_email: "cliente@example.com",
            },
            error: null,
          };
        }
        if (table === "dte_invoice_drafts") {
          if (query.operation === "insert") {
            insertedDraft = query.payload;
            capturedDrafts.push(query.payload);
            return { data: { id: "draft-1" }, error: null };
          }
          return {
            data: insertedDraft ? [{ id: "draft-1", ...insertedDraft }] : [],
            error: null,
          };
        }
        if (table === "dte_invoice_draft_lines") {
          return { data: [], error: null };
        }
        throw new Error(`Unexpected table ${table}`);
      });
    },
  };
  installMock(supabasePath, { supabaseAdmin });
  return require(draftRoutePath);
}

function contextualState() {
  return {
    appointmentId,
    customerId,
    saleId: canonicalSaleId,
    requestedDocumentType: 33,
    paymentState: "PAID",
    totalAmount: 119,
    intent: null,
    activeDraft: null,
    hasActiveCoverage: false,
  };
}

async function postDraft(route, body) {
  return route.POST(
    new Request("https://tenant.example/api/admin/invoice-drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId,
        dteType: 33,
        lines: [{}],
        ...body,
      }),
    }),
  );
}

test("draft contextual persiste exactamente la sale_id canónica", async () => {
  const capturedDrafts = [];
  const route = loadDraftRoute({ context: contextualState(), capturedDrafts });
  const response = await postDraft(route, {
    source: "appointment",
    appointmentId,
  });
  assert.equal(response.status, 201);
  assert.equal(capturedDrafts[0].sale_id, canonicalSaleId);
});

test("sale_id enviada por browser no reemplaza la venta canónica", async () => {
  const capturedDrafts = [];
  const route = loadDraftRoute({ context: contextualState(), capturedDrafts });
  const response = await postDraft(route, {
    source: "appointment",
    appointmentId,
    saleId: browserSaleId,
  });
  assert.equal(response.status, 201);
  assert.equal(capturedDrafts[0].sale_id, canonicalSaleId);
  assert.notEqual(capturedDrafts[0].sale_id, browserSaleId);
});

test("flujo manual standalone conserva sale_id nula", async () => {
  const capturedDrafts = [];
  const route = loadDraftRoute({ context: null, capturedDrafts });
  const response = await postDraft(route, {
    source: "manual",
    saleId: browserSaleId,
  });
  assert.equal(response.status, 201);
  assert.equal(capturedDrafts[0].sale_id, null);
});
