import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";
import { loadCafAuthorization, type CafTrustStore } from "./caf-secure-import";

export type RealCafAuditStatus =
  | "VERIFIED_LOCAL_AND_OFFICIAL"
  | "READY_FOR_CERTIFICATION_OFFLINE"
  | "BLOCKED_TRUST_ANCHOR";
export type RealCafAuditResult = {
  status: RealCafAuditStatus;
  materialKind: "certification_real";
  cafSha256: string;
  issuerMatch: "valid";
  type: 33;
  idk: "100";
  range: "1-5";
  coverage: 5;
  authorizationDateValid: true;
  structureValid: true;
  keyPairMatch: true;
  daPublicKeyMatch: true;
  exactBytesPreserved: true;
  fixtureKey: false;
  realUseBlocked: true;
  productionUseBlocked: true;
  certificationOfflineUseAllowed: boolean;
  manualProvenance: "accepted" | "not_requested";
  trustVerified: boolean;
  officialSiiTrustAnchor: "verified" | "pending";
  siiContacted: false;
  ledgerImported: false;
  foliosReserved: 0;
  dteGenerated: false;
};

function reject(field: string): never {
  throw new Error(`REAL_CAF_AUDIT_REJECTED field=${field}`);
}
function enabled(value: string | undefined): boolean {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}
function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) reject(name);
  return value;
}
function buildTrustStore(env: NodeJS.ProcessEnv): CafTrustStore {
  const idk = String(env.DTE_SII_TRUST_ANCHOR_IDK ?? "").trim();
  const publicKeyPath = String(env.DTE_SII_TRUST_ANCHOR_PATH ?? "").trim();
  const provenance = String(env.DTE_SII_TRUST_ANCHOR_PROVENANCE ?? "").trim();
  const sha256 = String(env.DTE_SII_TRUST_ANCHOR_SHA256 ?? "")
    .trim()
    .toLowerCase();
  const supplied = [idk, publicKeyPath, provenance, sha256].filter(
    Boolean,
  ).length;
  if (supplied === 0) return new Map();
  if (supplied !== 4) reject("trustAnchor.incomplete");
  if (!provenance.startsWith("official:")) reject("trustAnchor.provenance");
  if (!/^[a-f0-9]{64}$/.test(sha256)) reject("trustAnchor.sha256");
  return new Map([
    [idk, { idk, mode: "real", publicKeyPath, provenance, sha256 }],
  ]);
}

export function auditRealCertificationCaf(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): RealCafAuditResult {
  if (env.DTE_MODE !== "certification" || env.DTE_SII_ENV !== "certification")
    reject("environment");
  if (env.NODE_ENV === "production") reject("NODE_ENV");
  if (!enabled(env.DTE_ALLOW_REAL_CAF_AUDIT))
    reject("DTE_ALLOW_REAL_CAF_AUDIT");
  const manualProvenanceRequested = enabled(
    env.DTE_ALLOW_MANUAL_CAF_PROVENANCE,
  );
  const manualProvenanceConfirmation = String(
    env.DTE_CAF_MANUAL_PROVENANCE_CONFIRM ?? "",
  ).trim();
  if (
    manualProvenanceRequested &&
    manualProvenanceConfirmation !== "MAULLIN_CERTIFICATION_DOWNLOAD_REVIEWED"
  )
    reject("manualProvenance.confirmation");
  if (!manualProvenanceRequested && manualProvenanceConfirmation)
    reject("manualProvenance.flag");
  if (
    enabled(env.DTE_SII_ENABLE_SUBMIT) ||
    enabled(env.DTE_SII_ENABLE_STATUS) ||
    enabled(env.DTE_SII_LIVE_AUTH) ||
    env.DTE_SII_TOKEN ||
    env.DTE_TRACK_ID
  )
    reject("externalOperations");

  const cafPath = requireValue(env, "DTE_REAL_CAF_PATH");
  const expectedSha256 = requireValue(
    env,
    "DTE_REAL_CAF_EXPECTED_SHA256",
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256))
    reject("DTE_REAL_CAF_EXPECTED_SHA256");
  const contractPath = requireValue(env, "DTE_FACTURA_PRE_CAF_INPUT_PATH");
  const contract = loadFacturaPreCafInputFromPath({
    inputPath: contractPath,
    repoRoot,
    env,
  });
  if (!contract.ok || !contract.input.issuer?.rutEmisor)
    reject("externalContract");
  const expectedOwnerUid = process.getuid?.();
  if (expectedOwnerUid === undefined) reject("owner.unsupported");
  const trustStore = buildTrustStore(env);

  const caf = loadCafAuthorization(cafPath, {
    repoRoot,
    expectedIssuerRut: contract.input.issuer.rutEmisor,
    expectedType: 33,
    expectedRange: { from: 1, to: 5 },
    expectedIdk: "100",
    minimumAvailable: 4,
    expectedSha256,
    expectedOwnerUid,
    trustStore,
    fixtureMode: false,
    materialKind: "certification_real",
    allowPendingOfficialTrustAnchor: trustStore.size === 0,
  });
  if (
    caf.fixtureKey ||
    !caf.realUseBlocked ||
    caf.materialKind !== "certification_real"
  )
    reject("classification");
  if (
    !caf.originalBytes.equals(Buffer.from(caf.originalXml, "latin1")) ||
    caf.sha256 !== expectedSha256
  )
    reject("preservation");

  const trustVerified = caf.trustStatus === "verified_official";
  const certificationOfflineUseAllowed =
    !trustVerified && manualProvenanceRequested;

  return {
    status: trustVerified
      ? "VERIFIED_LOCAL_AND_OFFICIAL"
      : certificationOfflineUseAllowed
        ? "READY_FOR_CERTIFICATION_OFFLINE"
        : "BLOCKED_TRUST_ANCHOR",
    materialKind: "certification_real",
    cafSha256: caf.sha256,
    issuerMatch: "valid",
    type: 33,
    idk: "100",
    range: "1-5",
    coverage: 5,
    authorizationDateValid: true,
    structureValid: true,
    keyPairMatch: true,
    daPublicKeyMatch: true,
    exactBytesPreserved: true,
    fixtureKey: false,
    realUseBlocked: true,
    productionUseBlocked: true,
    certificationOfflineUseAllowed,
    manualProvenance: certificationOfflineUseAllowed
      ? "accepted"
      : "not_requested",
    trustVerified,
    officialSiiTrustAnchor: trustVerified ? "verified" : "pending",
    siiContacted: false,
    ledgerImported: false,
    foliosReserved: 0,
    dteGenerated: false,
  };
}

export function printRealCafAudit(result: RealCafAuditResult): void {
  const lines = [
    `status=${result.status}`,
    `cafSha256=${result.cafSha256}`,
    `type=${result.type}`,
    `range=${result.range}`,
    `idk=${result.idk}`,
    `issuerMatch=${result.issuerMatch}`,
    `manualProvenance=${result.manualProvenance}`,
    `officialSiiTrustAnchor=${result.officialSiiTrustAnchor}`,
    `trustVerified=${result.trustVerified}`,
    `certificationOfflineUseAllowed=${result.certificationOfflineUseAllowed}`,
    `productionUseBlocked=${result.productionUseBlocked}`,
    `siiContacted=${result.siiContacted}`,
    `ledgerImported=${result.ledgerImported}`,
    `foliosReserved=${result.foliosReserved}`,
    `dteGenerated=${result.dteGenerated}`,
  ];
  console.log(lines.join("\n"));
}
