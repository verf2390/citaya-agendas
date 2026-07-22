import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FacturaCertificationCaseId } from "./factura-electronica-set";
import { runFacturaSetDryRun } from "./factura-set-dry-run";
import {
  FolioSqliteLedger,
  type AllocationRequest,
} from "./folio-sqlite-ledger";
import { loadAuditedRealCertificationCafs } from "./caf-real-bundle-audit";
import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";

const CASES: readonly {
  caseId: FacturaCertificationCaseId;
  typeCode: 33 | 61 | 56;
  folio: number;
}[] = [
  { caseId: "4959698-1", typeCode: 33, folio: 1 },
  { caseId: "4959698-2", typeCode: 33, folio: 2 },
  { caseId: "4959698-3", typeCode: 33, folio: 3 },
  { caseId: "4959698-4", typeCode: 33, folio: 4 },
  { caseId: "4959698-5", typeCode: 61, folio: 1 },
  { caseId: "4959698-6", typeCode: 61, folio: 2 },
  { caseId: "4959698-7", typeCode: 61, folio: 3 },
  { caseId: "4959698-8", typeCode: 56, folio: 1 },
];
function fail(field: string): never {
  throw new Error(`CERTIFICATION_SET_PREPARE_REJECTED field=${field}`);
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) fail(name);
  return value;
}
function inside(repoRoot: string, path: string): boolean {
  const rel = relative(resolve(repoRoot), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}
function externalPath(
  env: NodeJS.ProcessEnv,
  name: string,
  repoRoot: string,
): string {
  const path = required(env, name);
  if (!isAbsolute(path) || inside(repoRoot, path)) fail(name);
  return resolve(path);
}
function secureFile(
  env: NodeJS.ProcessEnv,
  name: string,
  repoRoot: string,
): string {
  const path = externalPath(env, name, repoRoot);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path)
    fail(name);
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600)
    fail(name);
  return path;
}
export function expectedCertificationFolioPlan(): Record<
  FacturaCertificationCaseId,
  number
> {
  return Object.fromEntries(
    CASES.map((item) => [item.caseId, item.folio]),
  ) as Record<FacturaCertificationCaseId, number>;
}
export function prepareFacturaCertificationSet(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): {
  status: "PREPARED_CERTIFICATION_OFFLINE";
  attention: "4959698";
  documents: 8;
  folios: "33:1-4,61:1-3,56:1";
  contingency: "33:5,61:4,56:2";
  idempotent: true;
  siiContacted: false;
  submitted: false;
  statusQueried: false;
} {
  if (
    env.DTE_MODE !== "certification" ||
    env.DTE_SII_ENV !== "certification" ||
    env.NODE_ENV === "production"
  )
    fail("environment");
  if (
    env.DTE_SII_LIVE_AUTH === "true" ||
    env.DTE_SII_ENABLE_SUBMIT === "true" ||
    env.DTE_SII_ENABLE_STATUS === "true" ||
    env.DTE_SII_TOKEN ||
    env.DTE_TRACK_ID
  )
    fail("externalOperations");
  if (env.DTE_CERTIFICATION_SET_CONFIRM !== "PREPARE_SET_4959698_OFFLINE")
    fail("confirmation");
  const idempotencyKey = required(
    env,
    "DTE_FACTURA_CERTIFICATION_IDEMPOTENCY_KEY",
  );
  if (!/^[A-Za-z0-9._-]{8,80}$/.test(idempotencyKey)) fail("idempotencyKey");
  const outputDir = externalPath(
    env,
    "DTE_FACTURA_CERTIFICATION_OUTPUT_DIR",
    repoRoot,
  );
  const ledgerPath = externalPath(
    env,
    "DTE_FACTURA_CERTIFICATION_LEDGER_PATH",
    repoRoot,
  );
  const certificatePath = secureFile(env, "DTE_CERT_PATH", repoRoot);
  const privateKeyPath = secureFile(env, "DTE_PRIVATE_KEY_PATH", repoRoot);
  const external = loadFacturaPreCafInputFromPath({
    inputPath: env.DTE_FACTURA_PRE_CAF_INPUT_PATH,
    repoRoot,
    env,
  });
  if (
    !external.ok ||
    external.input.issuer?.fechaResolucion !== "2026-05-23" ||
    external.input.issuer?.numeroResolucion !== 0
  )
    fail("resolution");
  const audited = loadAuditedRealCertificationCafs(env, repoRoot);
  const contract = audited.cafs[0];
  const ledger = new FolioSqliteLedger(ledgerPath);
  try {
    audited.cafs.forEach((caf) => ledger.importCaf(caf));
    const requests: AllocationRequest[] = CASES.map((item) => ({
      caseId: `${idempotencyKey}:${item.caseId}`,
      typeCode: item.typeCode,
    }));
    const allocated = ledger.reservePlan(contract.issuerRut, requests);
    const folioByCase = Object.fromEntries(
      CASES.map((item) => [
        item.caseId,
        allocated[`${idempotencyKey}:${item.caseId}`],
      ]),
    ) as Record<FacturaCertificationCaseId, number>;
    if (CASES.some((item) => folioByCase[item.caseId] !== item.folio))
      fail("folioPlan");
    for (const [typeCode, folio] of [
      [33, 5],
      [61, 4],
      [56, 2],
    ] as const) {
      const row = ledger.db
        .prepare(
          "SELECT state FROM folios WHERE issuer=? AND type_code=? AND folio=?",
        )
        .get(contract.issuerRut, typeCode, folio) as
        { state: string } | undefined;
      if (row?.state !== "available") fail("contingency");
    }
    runFacturaSetDryRun({
      env,
      repoRoot,
      outputDir,
      realCertification: { privateKeyPath, certificatePath },
      overrides: {
        folioByCase,
        importedCafByType: Object.fromEntries(
          audited.cafs.map((caf) => [
            caf.typeCode,
            {
              cafXml: caf.cafXml,
              privateKeyPem: caf.privateKeyPem,
              publicKeyPem: caf.publicKeyPem,
            },
          ]),
        ),
      },
    });
    for (const request of requests) {
      const row = ledger.db
        .prepare("SELECT state FROM folios WHERE issuer=? AND reserved_case=?")
        .get(contract.issuerRut, request.caseId) as { state: string };
      if (row.state === "reserved")
        ledger.markIssued(contract.issuerRut, request.caseId);
      else if (row.state !== "issued") fail("folioState");
    }
  } finally {
    ledger.close();
  }
  return {
    status: "PREPARED_CERTIFICATION_OFFLINE",
    attention: "4959698",
    documents: 8,
    folios: "33:1-4,61:1-3,56:1",
    contingency: "33:5,61:4,56:2",
    idempotent: true,
    siiContacted: false,
    submitted: false,
    statusQueried: false,
  };
}
export function formatCertificationSetPrepare(
  result: ReturnType<typeof prepareFacturaCertificationSet>,
): string {
  return Object.entries(result)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}
