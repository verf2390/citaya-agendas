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
    issuerResolutionConfigured: false,
    certificateValid: true,
    certificateRutMatch: true,
    privateKeyMatchesCertificate: true,
    trustAnchorValid: false,
    trustAnchorSha256Pinned: false,
    trustAnchorAcquisitionProcedureReady: true,
    cafImportFailClosed: true,
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

test("declaration requires a secure anchor acquisition procedure and fail-closed import", () => {
  const missingProcedure = evaluateProductionReadiness({
    ...declarationEvidence(),
    trustAnchorAcquisitionProcedureReady: false,
  });
  assert.equal(missingProcedure.readyForDeclaration, false);
  assert.ok(
    missingProcedure.declarationBlockers.includes(
      "TRUST_ANCHOR_ACQUISITION_PROCEDURE_NOT_READY",
    ),
  );

  const importNotFailClosed = evaluateProductionReadiness({
    ...declarationEvidence(),
    cafImportFailClosed: false,
  });
  assert.equal(importNotFailClosed.readyForDeclaration, false);
  assert.ok(
    importNotFailClosed.declarationBlockers.includes(
      "CAF_IMPORT_NOT_FAIL_CLOSED",
    ),
  );
});

test("issuance requires approval, real CAF, folios, endpoints and flags", () => {
  const result = evaluateProductionReadiness({
    ...declarationEvidence(),
    issuerProfileState: "ready_for_issuance",
    issuerResolutionConfigured: true,
    trustAnchorValid: true,
    trustAnchorSha256Pinned: true,
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

test("issuance remains blocked without the official anchor and production CAF", () => {
  const result = evaluateProductionReadiness({
    ...declarationEvidence(),
    issuerProfileState: "declared",
    siiAuthorizationApproved: true,
    productionEndpointsReady: true,
  });
  assert.equal(result.readyForDeclaration, true);
  assert.equal(result.readyForIssuance, false);
  assert.ok(result.issuanceBlockers.includes("TRUST_ANCHOR_NOT_VALID"));
  assert.ok(
    result.issuanceBlockers.includes("TRUST_ANCHOR_SHA256_NOT_PINNED"),
  );
  assert.ok(result.issuanceBlockers.includes("PRODUCTION_CAF_NOT_IMPORTED"));
});
