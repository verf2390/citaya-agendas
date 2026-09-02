import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modal = readFileSync(
  "app/admin/agenda/components/AppointmentCreateModal.tsx",
  "utf8",
);
const agenda = readFileSync("app/admin/agenda/page.tsx", "utf8");
const createRoute = readFileSync(
  "app/api/appointments/create/route.ts",
  "utf8",
);

test("admin agenda modal defaults to boleta 39 and returns the explicit selection", () => {
  assert.match(modal, /useState<AdminAppointmentTaxDocumentType>\(39\)/);
  assert.match(modal, /setSelectedTaxDocumentType\(39\)/);
  assert.match(modal, /Documento tributario/);
  assert.match(modal, /Boleta electrónica \(39\)/);
  assert.match(modal, /Factura electrónica \(33\)/);
  assert.match(
    modal,
    /onConfirm\(\{[\s\S]*customerId: selected\.id,[\s\S]*serviceId: selectedServiceId,[\s\S]*taxDocumentType: selectedTaxDocumentType/,
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
