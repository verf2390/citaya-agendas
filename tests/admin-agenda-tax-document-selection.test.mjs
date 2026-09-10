import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { resolveBookingCommercialPolicy } from "../lib/tenant/booking-commercial-policy.mjs";

const modal = readFileSync(
  "app/admin/agenda/components/AppointmentCreateModal.tsx",
  "utf8",
);
const agenda = readFileSync("app/admin/agenda/page.tsx", "utf8");
const createRoute = readFileSync(
  "app/api/appointments/create/route.ts",
  "utf8",
);

const ts = createRequire(import.meta.url)("typescript");
const compiledModal = ts.transpileModule(modal, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function modalHarness(taxDocumentMode) {
  const states = [];
  let cursor = 0;
  const submissions = [];
  const props = {
    open: true, tenantId: "tenant-a", taxDocumentMode,
    startISO: "2026-09-09T12:00:00Z", endISO: "2026-09-09T13:00:00Z",
    customers: [{ id: "customer-a", name: "Cliente A", phone: null, email: "a@example.test" }],
    services: [{ id: "service-a", name: "Servicio A" }],
    onConfirm: async (payload) => { submissions.push(payload); },
    onClose() {},
  };
  const module = { exports: {} };
  const mockRequire = (name) => {
    if (name === "react/jsx-runtime") return {
      jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }),
    };
    if (name === "react") return {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value) => { states[index] = value; }];
      },
      useMemo: (fn) => fn(),
      // These tests exercise selection/confirmation, not modal mount effects.
      useEffect() {},
    };
    if (name === "@/components/ui/use-toast") return { toast() { assert.fail("unexpected toast"); } };
    if (name === "@/lib/supabaseClient") return { supabase: new Proxy({}, {
      get() { assert.fail("document selection must not contact Supabase"); },
    }) };
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function("require", "module", "exports", compiledModal)(mockRequire, module, module.exports);
  function render() {
    cursor = 0;
    return module.exports.default(props);
  }
  function nodes(tree) {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...nodes(tree.props?.children)];
  }
  function find(predicate) {
    const node = nodes(render()).find(predicate);
    assert.ok(node, "expected UI element");
    return node;
  }
  function selectBookingInputs() {
    find((node) => node.type === "select").props.onChange({ target: { value: "service-a" } });
    find((node) => node.props?.placeholder?.startsWith("Escribe al menos")).props.onChange({ target: { value: "Cliente" } });
    find((node) => node.type === "button" && JSON.stringify(node.props.children).includes("Cliente A")).props.onClick();
  }
  return {
    props, submissions, render, find, selectBookingInputs,
    radios: () => nodes(render()).filter((node) => node.props?.name === "taxDocumentType"),
    async confirm() {
      const button = find((node) => node.type === "button" && node.props.children === "Confirmar cita");
      assert.equal(button.props.disabled, false);
      await button.props.onClick();
      return submissions.at(-1);
    },
  };
}

test("external BHE admin modal hides DTE selection and submits null without DTE/payment effects", async () => {
  const ui = modalHarness("external_bhe");
  assert.equal(ui.radios().length, 0);
  assert.match(JSON.stringify(ui.render()), /se gestiona externamente por el prestador/);
  ui.selectBookingInputs();
  const selection = await ui.confirm();
  assert.deepEqual(selection, { customerId: "customer-a", serviceId: "service-a", taxDocumentType: null });
  const policy = resolveBookingCommercialPolicy({
    ...selection, invoiceRequested: selection.taxDocumentType === 33,
    isAdminRequest: true, taxDocumentMode: "external_bhe", paymentsEnabled: false, dteEnabled: false,
    servicePaymentPolicy: "deposit",
  });
  assert.equal(policy.requestedDocumentType, null);
  for (const field of ["persistDteSnapshot", "initializeDteBilling", "loadDteIssuanceConfig", "requireDteServiceConfiguration", "requirePaymentConfiguration", "paymentRequired"]) {
    assert.equal(policy[field], false, field);
  }
});

test("Citaya DTE admin modal preserves default 39 and explicit 33 selection", async () => {
  const ui = modalHarness("citaya_dte");
  assert.deepEqual(ui.radios().map((node) => [node.props.value, node.props.checked]), [[39, true], [33, false]]);
  ui.selectBookingInputs();
  assert.equal((await ui.confirm()).taxDocumentType, 39);
  ui.radios().find((node) => node.props.value === 33).props.onChange();
  assert.equal((await ui.confirm()).taxDocumentType, 33);
});

test("switching the modal to external BHE cannot submit a stale DTE choice", async () => {
  const ui = modalHarness("citaya_dte");
  ui.selectBookingInputs();
  ui.radios().find((node) => node.props.value === 33).props.onChange();
  ui.props.taxDocumentMode = "external_bhe";
  assert.equal(ui.radios().length, 0);
  assert.equal((await ui.confirm()).taxDocumentType, null);
});

test("unconfigured admin modal retains its existing selection and backend remains fail-closed", async () => {
  const ui = modalHarness("unconfigured");
  assert.equal(ui.radios().length, 2);
  ui.selectBookingInputs();
  const selection = await ui.confirm();
  assert.equal(selection.taxDocumentType, 39);
  assert.throws(() => resolveBookingCommercialPolicy({ ...selection, isAdminRequest: true, taxDocumentMode: "unconfigured" }),
    /BOOKING_TAX_DOCUMENT_MODE_UNCONFIGURED/);
});

test("admin agenda passes the resolved tenant tax mode into the modal without changing backend rules", () => {
  assert.match(agenda, /const resolvedTaxMode = result\.tenant\.tax_document_mode/);
  assert.match(agenda, /setTaxDocumentMode\([\s\S]*resolvedTaxMode === "citaya_dte" \|\| resolvedTaxMode === "external_bhe"/);
  assert.match(agenda, /<AppointmentCreateModal[\s\S]*taxDocumentMode=\{taxDocumentMode\}/);
  assert.match(createRoute, /if \(commercialPolicy\.persistDteSnapshot\) \{[\s\S]*"billing_initialize_appointment_sale"/);
  for (const taxDocumentType of [33, 39]) {
    assert.throws(() => resolveBookingCommercialPolicy({ taxDocumentMode: "external_bhe", taxDocumentType }),
      /BOOKING_DTE_SELECTION_NOT_AVAILABLE/);
  }
});

test("admin agenda modal defaults to boleta 39 and returns the explicit selection", () => {
  assert.match(modal, /useState<AdminAppointmentTaxDocumentType>\(39\)/);
  assert.match(modal, /setSelectedTaxDocumentType\(39\)/);
  assert.match(modal, /Documento tributario/);
  assert.match(modal, /Boleta electrónica \(39\)/);
  assert.match(modal, /Factura electrónica \(33\)/);
  assert.match(
    modal,
    /onConfirm\(\{[\s\S]*customerId: selected\.id,[\s\S]*serviceId: selectedServiceId,[\s\S]*taxDocumentType: externalBhe \? null : selectedTaxDocumentType/,
  );
});

test("admin agenda payload sends a consistent tax document selection", () => {
  assert.match(
    agenda,
    /taxDocumentType: args\.taxDocumentType,[\s\S]*invoiceRequested: args\.taxDocumentType === 33/,
  );
  assert.match(
    agenda,
    /onConfirm=\{async \(\{ customerId, serviceId, taxDocumentType \}\) =>/,
  );
  assert.doesNotMatch(
    agenda,
    /invoiceReceiver(?:Rut|LegalName|Activity|Address|Commune|City|TaxEmail)/,
  );
});

test("admin invoice profile is authorized, tenant-scoped and loaded before validation", () => {
  const authorizationIndex = createRoute.indexOf("requireTenantAdmin({ req, tenantId: input.tenantId })");
  const customerLookupIndex = createRoute.indexOf('.from("customers")', authorizationIndex);
  const profileLookupIndex = createRoute.indexOf('.from("customer_tax_profiles")', customerLookupIndex);
  const validationIndex = createRoute.indexOf("validateBookingTaxInput({", profileLookupIndex);
  assert.ok(authorizationIndex > -1);
  assert.ok(customerLookupIndex > authorizationIndex);
  assert.ok(profileLookupIndex > customerLookupIndex);
  assert.ok(validationIndex > profileLookupIndex);

  const customerLookup = createRoute.slice(customerLookupIndex, profileLookupIndex);
  assert.match(customerLookup, /\.eq\("tenant_id", input\.tenantId\)/);
  assert.match(customerLookup, /\.eq\("id", input\.customerId\)/);

  const profileLookup = createRoute.slice(profileLookupIndex, validationIndex);
  assert.match(profileLookup, /\.eq\("tenant_id", input\.tenantId\)/);
  assert.match(profileLookup, /\.eq\("customer_id", customer\.id\)/);
  for (const field of [
    "rut_normalized",
    "legal_name",
    "business_activity",
    "tax_address",
    "tax_commune",
    "tax_city",
    "tax_email",
  ]) {
    assert.match(profileLookup, new RegExp(field));
  }
});

test("admin invoice validation and snapshots prefer the stored profile over browser fields", () => {
  assert.match(
    createRoute,
    /customerRut: isDemoAppointment[\s\S]*adminInvoiceTaxProfile\?\.rut \?\? input\.customerRut/,
  );
  assert.match(
    createRoute,
    /taxProfile: requestedDocumentType === 33[\s\S]*\? adminInvoiceTaxProfile \?\? \{/,
  );
  assert.match(
    createRoute,
    /const invoiceReceiver = bookingTax\.taxProfile;/,
  );

  const snapshotStart = createRoute.indexOf("const invoiceReceiver = bookingTax.taxProfile;");
  const snapshotEnd = createRoute.indexOf("if (taxSnapshotError)", snapshotStart);
  const snapshot = createRoute.slice(snapshotStart, snapshotEnd);
  assert.match(snapshot, /invoice_receiver_rut: invoiceReceiver\?\.rut \?\? null/);
  assert.match(snapshot, /invoice_receiver_legal_name: invoiceReceiver\?\.legalName \?\? null/);
  assert.match(snapshot, /invoice_receiver_activity: invoiceReceiver\?\.businessActivity \?\? null/);
  assert.match(snapshot, /invoice_receiver_address: invoiceReceiver\?\.address \?\? null/);
  assert.match(snapshot, /invoice_receiver_commune: invoiceReceiver\?\.commune \?\? null/);
  assert.match(snapshot, /invoice_receiver_city: invoiceReceiver\?\.city \?\? null/);
  assert.match(snapshot, /customer_rut_snapshot: bookingTax\.customerRut \|\| null/);
  assert.match(snapshot, /requested_document_type: bookingTax\.requestedDocumentType/);
  assert.match(snapshot, /tax_document_selection: bookingTax\.requestedDocumentType/);
  assert.match(snapshot, /tax_treatment_snapshot: taxTreatmentSnapshot/);
  assert.doesNotMatch(snapshot, /input\.invoiceReceiver/);
  assert.match(
    createRoute,
    /"billing_initialize_appointment_sale"[\s\S]*p_requested_document_type: bookingTax\.requestedDocumentType/,
  );
});

test("incomplete profile fails before appointment creation or sale initialization", () => {
  assert.match(createRoute, /code: "DATOS_TRIBUTARIOS_FACTURA_INCOMPLETOS"/);
  assert.match(
    createRoute,
    /El cliente no tiene un perfil tributario completo para emitir factura\./,
  );
  const guardIndex = createRoute.indexOf(
    "if (!isDemoAppointment && isAdminRequest && requestedDocumentType === 33)",
  );
  const creationIndex = createRoute.indexOf("const rpcName =", guardIndex);
  const saleIndex = createRoute.indexOf('"billing_initialize_appointment_sale"', guardIndex);
  assert.ok(guardIndex > -1);
  assert.ok(creationIndex > guardIndex);
  assert.ok(saleIndex > creationIndex);
  assert.ok(createRoute.indexOf("incompleteAdminInvoiceProfileError()", guardIndex) < creationIndex);
});

test("admin profile is read-only while the existing public profile flow remains intact", () => {
  assert.match(
    createRoute,
    /if \(!isDemoAppointment && !isAdminRequest && bookingTax\.taxProfile\) \{[\s\S]*\.from\("customer_tax_profiles"\)\.upsert/,
  );
  assert.match(
    createRoute,
    /adminInvoiceTaxProfile \?\? \{[\s\S]*rut: input\.invoiceReceiverRut[\s\S]*taxEmail: input\.invoiceReceiverTaxEmail \?\? input\.customerEmail/,
  );
  assert.match(
    createRoute,
    /!isDemoAppointment && !isAdminRequest && requestedDocumentType === 33/,
  );
  assert.match(
    createRoute,
    /!isDemoAppointment && !isAdminRequest && requestedDocumentType === 39/,
  );
});

test("appointment response and logs do not expose receiver tax data", () => {
  const successResponse = createRoute.match(
    /return NextResponse\.json\(\{\s*ok: true,[\s\S]*?\n\s*\}\);/,
  )?.[0] ?? "";
  assert.ok(successResponse);
  assert.doesNotMatch(successResponse, /storedProfile|adminInvoiceTaxProfile|invoice_receiver|rut_normalized|tax_email/);

  const logCalls = [...createRoute.matchAll(/console\.(?:warn|error)\(/g)]
    .map((match) => {
      const start = match.index ?? 0;
      const end = createRoute.indexOf(");", start);
      return createRoute.slice(start, end + 2);
    })
    .join("\n");
  assert.equal([...createRoute.matchAll(/console\.(?:warn|error)\(/g)].length, 4);
  assert.doesNotMatch(logCalls, /storedProfile|adminInvoiceTaxProfile|invoice_receiver|rut_normalized|tax_email/);
});
