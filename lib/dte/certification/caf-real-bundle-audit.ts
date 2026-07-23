import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";
import {
  loadCafAuthorization,
  type CafTrustStore,
  type ImportedCaf,
} from "./caf-secure-import";

type CafType = 33 | 56 | 61;
const SPECS = [
  {
    type: 33 as CafType,
    range: { from: 1, to: 5 },
    pathVar: "DTE_REAL_CAF_33_PATH",
    shaVar: "DTE_REAL_CAF_33_SHA256",
  },
  {
    type: 33 as CafType,
    range: { from: 6, to: 8 },
    pathVar: "DTE_REAL_CAF_33_6_8_PATH",
    shaVar: "DTE_REAL_CAF_33_6_8_SHA256",
  },
  {
    type: 61 as CafType,
    range: { from: 1, to: 4 },
    pathVar: "DTE_REAL_CAF_61_PATH",
    shaVar: "DTE_REAL_CAF_61_SHA256",
  },
  {
    type: 61 as CafType,
    range: { from: 5, to: 6 },
    pathVar: "DTE_REAL_CAF_61_5_6_PATH",
    shaVar: "DTE_REAL_CAF_61_5_6_SHA256",
  },
  {
    type: 56 as CafType,
    range: { from: 1, to: 2 },
    pathVar: "DTE_REAL_CAF_56_PATH",
    shaVar: "DTE_REAL_CAF_56_SHA256",
  },
] as const;
export type RealCafBundleAuditResult = {
  status: "READY_FOR_CERTIFICATION_OFFLINE";
  attention: "4959698";
  cafs: ReadonlyArray<{ type: CafType; range: string; sha256: string }>;
  idk: "100";
  issuerMatch: "valid";
  manualProvenance: "accepted";
  officialSiiTrustAnchor: "pending";
  trustVerified: false;
  certificationOfflineUseAllowed: true;
  productionUseBlocked: true;
  siiContacted: false;
  ledgerImported: false;
  foliosReserved: 0;
  dteGenerated: false;
};
function reject(field: string): never {
  throw new Error(`REAL_CAF_BUNDLE_REJECTED field=${field}`);
}
function enabled(value: string | undefined): boolean {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) reject(name);
  return value;
}
function trustStore(env: NodeJS.ProcessEnv): CafTrustStore {
  const values = [
    env.DTE_SII_TRUST_ANCHOR_IDK,
    env.DTE_SII_TRUST_ANCHOR_PATH,
    env.DTE_SII_TRUST_ANCHOR_PROVENANCE,
    env.DTE_SII_TRUST_ANCHOR_SHA256,
  ].map((value) => String(value ?? "").trim());
  if (values.every((value) => !value)) return new Map();
  if (values.some((value) => !value)) reject("trustAnchor.incomplete");
  if (!values[2].startsWith("official:")) reject("trustAnchor.provenance");
  if (!/^[a-f0-9]{64}$/i.test(values[3])) reject("trustAnchor.sha256");
  return new Map([
    [
      values[0],
      {
        idk: values[0],
        mode: "real",
        publicKeyPath: values[1],
        provenance: values[2],
        sha256: values[3].toLowerCase(),
      },
    ],
  ]);
}
export function loadAuditedRealCertificationCafs(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): { cafs: readonly ImportedCaf[]; result: RealCafBundleAuditResult } {
  if (env.DTE_MODE !== "certification" || env.DTE_SII_ENV !== "certification")
    reject("environment");
  if (env.NODE_ENV === "production") reject("NODE_ENV");
  if (
    enabled(env.DTE_SII_LIVE_AUTH) ||
    enabled(env.DTE_SII_ENABLE_SUBMIT) ||
    enabled(env.DTE_SII_ENABLE_STATUS) ||
    env.DTE_SII_TOKEN ||
    env.DTE_TRACK_ID
  )
    reject("externalOperations");
  if (!enabled(env.DTE_ALLOW_REAL_CAF_AUDIT))
    reject("DTE_ALLOW_REAL_CAF_AUDIT");
  if (!enabled(env.DTE_ALLOW_MANUAL_CAF_PROVENANCE))
    reject("manualProvenance.flag");
  if (
    env.DTE_CAF_MANUAL_PROVENANCE_CONFIRM !==
    "MAULLIN_CERTIFICATION_DOWNLOAD_REVIEWED"
  )
    reject("manualProvenance.confirmation");
  const loaded = loadFacturaPreCafInputFromPath({
    inputPath: required(env, "DTE_FACTURA_PRE_CAF_INPUT_PATH"),
    repoRoot,
    env,
  });
  if (!loaded.ok || !loaded.input.issuer?.rutEmisor) reject("externalContract");
  const owner = process.getuid?.();
  if (owner === undefined) reject("owner.unsupported");
  const anchors = trustStore(env);
  const specs = env.DTE_FACTURA_CERTIFICATION_REISSUE_NUMBER === "1"
    ? SPECS
    : SPECS.filter((spec) => spec.range.from === 1);
  const cafs = specs.map((spec) => {
    const expectedSha256 = required(env, spec.shaVar).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) reject(spec.shaVar);
    return loadCafAuthorization(required(env, spec.pathVar), {
      repoRoot,
      expectedIssuerRut: loaded.input.issuer?.rutEmisor ?? "",
      expectedType: spec.type,
      expectedRange: spec.range,
      expectedIdk: "100",
      minimumAvailable: spec.range.to - spec.range.from + 1,
      expectedSha256,
      expectedOwnerUid: owner,
      trustStore: anchors,
      fixtureMode: false,
      materialKind: "certification_real",
      allowPendingOfficialTrustAnchor: anchors.size === 0,
    });
  });
  if (anchors.size > 0) reject("manualProvenance.trustAnchorSupplied");
  if (
    cafs.some(
      (caf) =>
        caf.fixtureKey ||
        !caf.realUseBlocked ||
        caf.materialKind !== "certification_real" ||
        caf.trustStatus !== "pending_official" ||
        !caf.originalBytes.equals(Buffer.from(caf.originalXml, "latin1")),
    )
  )
    reject("classification");
  if (new Set(cafs.map((caf) => caf.issuerRut)).size !== 1)
    reject("issuerMismatch");
  const identities = new Set(
    cafs.map((caf) => `${caf.typeCode}:${caf.rangeFrom}-${caf.rangeTo}`),
  );
  if (identities.size !== specs.length) reject("coverage.duplicate");
  const result: RealCafBundleAuditResult = {
    status: "READY_FOR_CERTIFICATION_OFFLINE",
    attention: "4959698",
    cafs: specs.map((spec, index) => ({
      type: spec.type,
      range: `${spec.range.from}-${spec.range.to}`,
      sha256: cafs[index].sha256,
    })),
    idk: "100",
    issuerMatch: "valid",
    manualProvenance: "accepted",
    officialSiiTrustAnchor: "pending",
    trustVerified: false,
    certificationOfflineUseAllowed: true,
    productionUseBlocked: true,
    siiContacted: false,
    ledgerImported: false,
    foliosReserved: 0,
    dteGenerated: false,
  };
  return { cafs, result };
}
export function auditRealCertificationCafBundle(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): RealCafBundleAuditResult {
  return loadAuditedRealCertificationCafs(env, repoRoot).result;
}
export function formatRealCafBundleAudit(
  result: RealCafBundleAuditResult,
): string {
  return [
    `status=${result.status}`,
    `attention=${result.attention}`,
    ...result.cafs.map(
      (caf) => `cafType${caf.type}=sha256:${caf.sha256},range:${caf.range}`,
    ),
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
  ].join("\n");
}
