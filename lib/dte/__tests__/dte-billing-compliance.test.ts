import assert from "node:assert/strict";
import test from "node:test";

import {
  billingComplianceLabels,
  deriveBillingCompliance,
} from "../billing-compliance";

test("active evidence and persisted gates are the single billing truth", () => {
  const state = deriveBillingCompliance({
    globalProductionEnabled: true,
    tenantProductionEnabled: true,
    issuerEnabled: true,
    issuerProfileState: "ready_for_issuance",
    authorizationEvidenceCurrent: true,
    authorizedTypes: [33, 34, 39, 52, 56, 61],
    activeTypes: [33, 56, 61],
    activationGates: {
      33: { ready: true },
      56: { ready: true },
      61: { ready: true },
    },
  });

  assert.equal(state.declarationRegistered, true);
  assert.equal(state.authorizationCurrent, true);
  assert.equal(state.issuanceEnabled, true);
  assert.equal(state.readyForFirstInvoiceFromUi, true);
  assert.deepEqual(state.activeDocumentTypes, [33, 56, 61]);

  const labels = billingComplianceLabels(state);
  assert.equal(labels.declaration, "Declaración cumplida");
  assert.equal(labels.authorization, "Autorización SII vigente");
  assert.equal(labels.issuance, "Emisión habilitada para 33, 56 y 61");
  assert.doesNotMatch(labels.issuance, /Emisión bloqueada/);
});

test("unsupported and unauthorized types cannot become visually active", () => {
  const state = deriveBillingCompliance({
    globalProductionEnabled: true,
    tenantProductionEnabled: true,
    issuerEnabled: true,
    issuerProfileState: "ready_for_issuance",
    authorizationEvidenceCurrent: true,
    authorizedTypes: [33, 34, 39, 52, 56, 61],
    activeTypes: [33, 34, 39, 41, 52, 56, 61],
    activationGates: { 33: { ready: true }, 56: { ready: true }, 61: { ready: true } },
  });

  assert.deepEqual(state.activeDocumentTypes, [33, 56, 61]);
  assert.equal(state.readyForFirstInvoiceFromUi, false);
  assert.equal(billingComplianceLabels(state).issuance, "Emisión bloqueada");
});
