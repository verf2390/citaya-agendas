export type ProductionReadinessEvidence = {
  tenantResolved: boolean;
  issuerProfileComplete: boolean;
  issuerProfileState:
    | "pre_declaration"
    | "declared"
    | "ready_for_issuance"
    | "suspended";
  issuerResolutionConfigured: boolean;
  certificateValid: boolean;
  certificateRutMatch: boolean;
  privateKeyMatchesCertificate: boolean;
  trustAnchorValid: boolean;
  trustAnchorSha256Pinned: boolean;
  trustAnchorAcquisitionProcedureReady: boolean;
  cafImportFailClosed: boolean;
  privateBucketReady: boolean;
  persistenceReady: boolean;
  ledgerReady: boolean;
  workerTenantAware: boolean;
  idempotencyReady: boolean;
  cafProceduresReady: boolean;
  productionCafRootReady: boolean;
  tenantIsolationValid: boolean;
  tenantProductionEnabled: boolean;
  automaticIssuanceEnabled: boolean;
  siiAuthorizationApproved: boolean;
  productionCafCount: number;
  availableFolioCount: number;
  productionEndpointsReady: boolean;
  globalProductionEnabled: boolean;
};

export type ProductionReadiness = {
  readyForDeclaration: boolean;
  readyForIssuance: boolean;
  declarationBlockers: string[];
  issuanceBlockers: string[];
};

function missing(
  evidence: ProductionReadinessEvidence,
  checks: Array<[keyof ProductionReadinessEvidence, string]>,
) {
  return checks
    .filter(([key]) => evidence[key] !== true)
    .map(([, reason]) => reason);
}

export function evaluateProductionReadiness(
  evidence: ProductionReadinessEvidence,
): ProductionReadiness {
  const commonBlockers = missing(evidence, [
    ["tenantResolved", "TENANT_NOT_RESOLVED"],
    ["issuerProfileComplete", "ISSUER_PROFILE_INCOMPLETE"],
    ["certificateValid", "CERTIFICATE_NOT_VALID"],
    ["certificateRutMatch", "CERTIFICATE_RUT_MISMATCH"],
    ["privateKeyMatchesCertificate", "PRIVATE_KEY_MISMATCH"],
    [
      "trustAnchorAcquisitionProcedureReady",
      "TRUST_ANCHOR_ACQUISITION_PROCEDURE_NOT_READY",
    ],
    ["cafImportFailClosed", "CAF_IMPORT_NOT_FAIL_CLOSED"],
    ["privateBucketReady", "PRIVATE_BUCKET_NOT_READY"],
    ["persistenceReady", "PERSISTENCE_NOT_READY"],
    ["ledgerReady", "LEDGER_NOT_READY"],
    ["workerTenantAware", "WORKER_NOT_TENANT_AWARE"],
    ["idempotencyReady", "IDEMPOTENCY_NOT_READY"],
    ["cafProceduresReady", "CAF_PROCEDURES_NOT_READY"],
    ["productionCafRootReady", "PRODUCTION_CAF_ROOT_NOT_READY"],
    ["tenantIsolationValid", "TENANT_ISOLATION_NOT_VALID"],
  ]);
  if (evidence.issuerProfileState === "suspended")
    commonBlockers.push("ISSUER_PROFILE_SUSPENDED");

  const declarationBlockers = [...commonBlockers];
  if (evidence.tenantProductionEnabled)
    declarationBlockers.push("TENANT_PRODUCTION_MUST_REMAIN_DISABLED");
  if (evidence.automaticIssuanceEnabled)
    declarationBlockers.push("AUTOMATIC_ISSUANCE_MUST_REMAIN_DISABLED");
  if (evidence.globalProductionEnabled)
    declarationBlockers.push("GLOBAL_PRODUCTION_MUST_REMAIN_DISABLED");

  const issuanceBlockers = [...commonBlockers];
  if (!evidence.issuerResolutionConfigured)
    issuanceBlockers.push("SII_RESOLUTION_NOT_CONFIGURED");
  if (!evidence.trustAnchorValid)
    issuanceBlockers.push("TRUST_ANCHOR_NOT_VALID");
  if (!evidence.trustAnchorSha256Pinned)
    issuanceBlockers.push("TRUST_ANCHOR_SHA256_NOT_PINNED");
  if (
    !["declared", "ready_for_issuance"].includes(
      evidence.issuerProfileState,
    )
  )
    issuanceBlockers.push("SII_DECLARATION_NOT_COMPLETED");
  if (!evidence.siiAuthorizationApproved)
    issuanceBlockers.push("SII_ISSUER_NOT_APPROVED");
  if (evidence.productionCafCount < 1)
    issuanceBlockers.push("PRODUCTION_CAF_NOT_IMPORTED");
  if (evidence.availableFolioCount < 1)
    issuanceBlockers.push("PRODUCTION_FOLIOS_UNAVAILABLE");
  if (!evidence.productionEndpointsReady)
    issuanceBlockers.push("PRODUCTION_ENDPOINTS_NOT_READY");
  if (!evidence.tenantProductionEnabled)
    issuanceBlockers.push("TENANT_PRODUCTION_DISABLED");
  if (!evidence.automaticIssuanceEnabled)
    issuanceBlockers.push("AUTOMATIC_ISSUANCE_DISABLED");
  if (!evidence.globalProductionEnabled)
    issuanceBlockers.push("GLOBAL_PRODUCTION_DISABLED");

  return {
    readyForDeclaration: declarationBlockers.length === 0,
    readyForIssuance: issuanceBlockers.length === 0,
    declarationBlockers,
    issuanceBlockers,
  };
}
