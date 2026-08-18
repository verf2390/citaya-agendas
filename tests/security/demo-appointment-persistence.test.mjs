import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createRoute = readFileSync("app/api/appointments/create/route.ts", "utf8");
const tenantRoute = readFileSync("app/api/tenants/by-slug/route.ts", "utf8");
const bookingPage = readFileSync("app/reservar/page.tsx", "utf8");
const confirmationPage = readFileSync("app/reservar/confirmacion/page.tsx", "utf8");

test("[structural] safe demo uses the persisted RPC without productive legal or tax input", () => {
  assert.match(createRoute, /const isDemoAppointment = isSafeDemoAppointmentMode\(/);
  assert.match(createRoute, /isDemoAppointment\s*\? null\s*:\s*input\.taxDocumentType/);
  assert.match(createRoute, /customerRut: isDemoAppointment \? undefined : input\.customerRut/);
  assert.match(createRoute, /if \(!isDemoAppointment\) \{\s*const legalBundle/);
  assert.match(
    createRoute,
    /const rpcName = isAdminRequest \|\| isDemoAppointment\s*\? "create_public_appointment"\s*:\s*"create_public_appointment_with_legal_acceptance"/,
  );
  assert.match(createRoute, /if \(!isAdminRequest && !isDemoAppointment\) \{/);
  assert.match(createRoute, /persisted: true/);
  assert.doesNotMatch(createRoute, /createDemoSimulation/);
});

test("[structural] safe demo forces no payment and bypasses billing initialization", () => {
  assert.match(
    createRoute,
    /const paymentRequired = !isDemoAppointment && service\.payment_policy !== "no_advance"/,
  );
  assert.match(
    createRoute,
    /p_payment_status: isDemoAppointment\s*\? "not_required"/,
  );
  const productiveEffects = createRoute.match(
    /if \(!isDemoAppointment\) \{[\s\S]*?billing_initialize_appointment_sale[\s\S]*?\n    \}/,
  );
  assert.ok(productiveEffects, "billing must remain inside the productive-only branch");
  assert.match(productiveEffects[0], /customer_rut_snapshot/);
  assert.match(productiveEffects[0], /tax_document_selection/);
});

test("[structural] demo appointment creation uses only the narrow appointment dispatcher", () => {
  assert.match(createRoute, /shouldDispatchAppointmentCreatedEvent/);
  assert.match(createRoute, /dispatchAppointmentCreatedEvent/);
  assert.doesNotMatch(createRoute, /sendExternalEmail|sendCampaign|callExternalAutomation/);
});

test("[structural] demo document choice is separate from productive Boleta 39 capability", () => {
  assert.match(
    tenantRoute,
    /safeDemoAppointment\s*\? Promise\.resolve\([\s\S]*?\)\s*:\s*getTenantPaymentConfig/,
  );
  assert.match(
    tenantRoute,
    /demo_document_selection_enabled: safeDemoAppointment/,
  );
  assert.match(
    tenantRoute,
    /boleta_document_selection_enabled:\s*operationalCapabilities\.publicTaxDocument/,
  );
  assert.doesNotMatch(
    tenantRoute,
    /demo_document_selection_enabled:[\s\S]{0,120}production_authorized/,
  );
  assert.match(
    bookingPage,
    /Boleta electrónica — simulación/,
  );
  assert.match(
    bookingPage,
    /Factura electrónica — simulación/,
  );
  assert.match(
    bookingPage,
    /const productiveTaxDocumentType = isSafeDemoAppointment\s*\? null/,
  );
  assert.match(
    bookingPage,
    /customerRut: !isSafeDemoAppointment && taxDocumentType === 33/,
  );
});

test("[structural] demo submit keeps normal booking/contact minimums and bypasses productive legal gates", () => {
  for (const requirement of [
    /!!serviceId/,
    /!!selectedSlot/,
    /!!professionalId/,
    /fullName\.trim\(\)\.length >= 2/,
    /isPhoneValid/,
    /isValidEmail\(email\)/,
  ]) {
    assert.match(bookingPage, requirement);
  }
  assert.match(
    bookingPage,
    /const legalRequirementsComplete = isSafeDemoAppointment \|\| \(/,
  );
  assert.match(
    bookingPage,
    /const paymentRequirementsComplete = isSafeDemoAppointment \|\| \(/,
  );
  assert.match(
    bookingPage,
    /acceptedLegalBundle = isSafeDemoAppointment \? null : legalBundle/,
  );
});

test("[structural] live Factura 33 and Boleta 39 retain productive validation paths", () => {
  assert.match(
    createRoute,
    /taxProfile: requestedDocumentType === 33 \? \{/,
  );
  assert.match(createRoute, /if \(!isDemoAppointment && bookingTax\.taxProfile\)/);
  assert.match(createRoute, /if \(!isDemoAppointment && requestedDocumentType === 39\)/);
  assert.match(createRoute, /certification_status !== "production_authorized"/);
  assert.match(createRoute, /billing_initialize_appointment_sale/);
});

test("[structural] persisted confirmation uses safe demo presentation without widening manage-token PII", () => {
  assert.doesNotMatch(bookingPage, /confirmacion\?demo=1/);
  assert.doesNotMatch(confirmationPage, /sp\.get\("demo"\)|demoSimulation/);
  assert.match(confirmationPage, /citaya_manage_token:/);
  assert.match(confirmationPage, /isSafeDemoAppointmentMode\(/);
  assert.match(
    confirmationPage,
    /Tu reserva de demostración quedó registrada correctamente\. Puedes gestionarla desde este enlace seguro\./,
  );
  assert.match(
    confirmationPage,
    /tenantOperationalStateLoaded && !isSafeDemoAppointment \? \([\s\S]*?Abrir WhatsApp \(opcional\)/,
  );
  assert.match(confirmationPage, /safeText\(appt\?\.customer_name\) \?/);
  assert.match(confirmationPage, /safeText\(appt\?\.customer_email\) \?/);
  assert.match(confirmationPage, /safeText\(appt\?\.customer_phone\) \?/);
});

test("[structural] demo security is capability-based and never keyed to the demo hostname", () => {
  for (const source of [createRoute, tenantRoute, bookingPage, confirmationPage]) {
    assert.doesNotMatch(source, /demo\.citaya\.online/i);
  }
});
