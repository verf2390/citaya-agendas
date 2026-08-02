import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validatePublicLegalConsent } from "../../lib/legal/consent.mjs";

const hash = "a".repeat(64);
const document = (type) => ({ id: `doc-${type}`, version: 2, hash, title: type });
const documents = Object.fromEntries([
  "consumer_terms", "privacy_notice", "cancellation_refund_policy", "sensitive_data_authorization",
].map((type) => [type, document(type)]));
const accepted = (type) => ({ documentId: documents[type].id, version: 2, hash, accepted: true, declaration: `Aceptación concreta de ${type}` });

test("public booking requires exact tenant terms and conditional sensitive consent while marketing stays optional", async () => {
  const bundle = { tenantId: "tenant-a", identity: { complete: true }, handlesSensitiveData: false, documents };
  const base = {
    consumer_terms: accepted("consumer_terms"),
    privacy_notice: accepted("privacy_notice"),
    cancellation_refund_policy: accepted("cancellation_refund_policy"),
  };
  assert.equal(validatePublicLegalConsent({ tenantId: "tenant-a", bundle, consent: base }).ok, true);
  assert.equal(validatePublicLegalConsent({ tenantId: "tenant-b", bundle, consent: base }).ok, false);
  assert.equal(validatePublicLegalConsent({ tenantId: "tenant-a", bundle, consent: { ...base, consumer_terms: { ...base.consumer_terms, accepted: false } } }).ok, false);
  assert.equal(validatePublicLegalConsent({ tenantId: "tenant-a", bundle: { ...bundle, handlesSensitiveData: true }, consent: base }).ok, false);
  assert.equal(validatePublicLegalConsent({ tenantId: "tenant-a", bundle: { ...bundle, handlesSensitiveData: true }, consent: { ...base, sensitive_data_authorization: accepted("sensitive_data_authorization") } }).ok, true);

  const page = await readFile(new URL("../../app/reservar/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../../app/api/appointments/create/route.ts", import.meta.url), "utf8");
  assert.match(page, /He leído y acepto los términos y la política de cancelación del prestador/);
  assert.match(page, /marketingAccepted/);
  assert.match(page, /useState\(false\)/);
  assert.match(route, /resolveTenantForPublicRequest/);
  assert.match(route, /create_public_appointment_with_legal_acceptance/);
});
