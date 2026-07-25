import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateProductionReadiness,
  type ProductionReadinessEvidence,
} from "../readiness/production-readiness";

function declarationEvidence(): ProductionReadinessEvidence {
  return {
    tenantResolved: true,
    issuerProfileComplete: true,
    issuerProfileState: "pre_declaration",
    certificateValid: true,
    certificateRutMatch: true,
    privateKeyMatchesCertificate: true,
    trustAnchorValid: true,
    privateBucketReady: true,
    persistenceReady: true,
    ledgerReady: true,
    workerTenantAware: true,
    idempotencyReady: true,
    cafProceduresReady: true,
    productionCafRootReady: true,
    tenantIsolationValid: true,
    tenantProductionEnabled: false,
    automaticIssuanceEnabled: false,
    siiAuthorizationApproved: false,
    productionCafCount: 0,
    availableFolioCount: 0,
    productionEndpointsReady: false,
    globalProductionEnabled: false,
  };
}

test("pre-declaration can be ready without being ready for issuance", () => {
  const result = evaluateProductionReadiness(declarationEvidence());
  assert.equal(result.readyForDeclaration, true);
  assert.equal(result.readyForIssuance, false);
  assert.ok(result.issuanceBlockers.includes("SII_DECLARATION_NOT_COMPLETED"));
  assert.ok(result.issuanceBlockers.includes("PRODUCTION_CAF_NOT_IMPORTED"));
});

test("trust anchor is mandatory and cannot be replaced by certification CAF", () => {
  const result = evaluateProductionReadiness({
    ...declarationEvidence(),
    trustAnchorValid: false,
  });
  assert.equal(result.readyForDeclaration, false);
  assert.ok(result.declarationBlockers.includes("TRUST_ANCHOR_NOT_VALID"));
});

test("issuance requires approval, real CAF, folios, endpoints and flags", () => {
  const result = evaluateProductionReadiness({
    ...declarationEvidence(),
    issuerProfileState: "ready_for_issuance",
    siiAuthorizationApproved: true,
    productionCafCount: 1,
    availableFolioCount: 10,
    productionEndpointsReady: true,
    tenantProductionEnabled: true,
    automaticIssuanceEnabled: true,
    globalProductionEnabled: true,
  });
  assert.equal(result.readyForDeclaration, false);
  assert.equal(result.readyForIssuance, true);
});
