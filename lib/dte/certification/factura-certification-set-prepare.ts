import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FacturaCertificationCaseId } from "./factura-electronica-set";
import {
  runFacturaSetDryRun,
  type FacturaSetDryRunStage,
} from "./factura-set-dry-run";
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

export type CertificationPrepareStage =
  | "preflight"
  | "caf_bundle"
  | "certificate_material"
  | "generation_config"
  | "caf_material_load"
  | "document_model"
  | "document_signing"
  | "ledger_open"
  | "reservation_reuse"
  | "output_preflight"
  | "manifest_build"
  | "document_build"
  | "ted_frmt"
  | "dte_signature"
  | "envelope_build"
  | "xsd_validation"
  | "output_write"
  | "ledger_finalize";

export class CertificationSetPrepareError extends Error {
  readonly code = "CERTIFICATION_SET_PREPARE_REJECTED";
  readonly internalCause: unknown;
  constructor(
    readonly stage: CertificationPrepareStage,
    readonly field: string,
    cause?: unknown,
  ) {
    super("Controlled certification preparation failed");
    this.name = "CertificationSetPrepareError";
    this.internalCause = cause;
  }
}
function safeField(field: string): string {
  return /^[a-z][a-z0-9_.-]{0,63}$/i.test(field) ? field : "internal";
}
function fail(
  stage: CertificationPrepareStage,
  field: string,
  cause?: unknown,
): never {
  throw new CertificationSetPrepareError(stage, safeField(field), cause);
}
function wrap(
  error: unknown,
  stage: CertificationPrepareStage,
  field: string,
): CertificationSetPrepareError {
  return error instanceof CertificationSetPrepareError
    ? error
    : new CertificationSetPrepareError(stage, safeField(field), error);
}
function atStage<T>(
  name: CertificationPrepareStage,
  field: string,
  action: () => T,
): T {
  try {
    return action();
  } catch (error) {
    throw wrap(error, name, field);
  }
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) fail("preflight", name.toLowerCase());
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
  if (!isAbsolute(path) || inside(repoRoot, path))
    fail("preflight", name.toLowerCase());
  return resolve(path);
}
function secureFile(
  env: NodeJS.ProcessEnv,
  name: string,
  repoRoot: string,
): string {
  return atStage("certificate_material", name.toLowerCase(), () => {
    const path = externalPath(env, name, repoRoot);
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      realpathSync(path) !== path ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    )
      fail("certificate_material", name.toLowerCase());
    return path;
  });
}
export function assertCertificationOutputPreflight(outputDir: string): void {
  if (!existsSync(outputDir)) return;
  atStage("output_preflight", "output", () => {
    const stat = lstatSync(outputDir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(outputDir) !== outputDir ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700
    )
      fail("output_preflight", "output.metadata");
    if (readdirSync(outputDir).length !== 0)
      fail("output_preflight", "output.not_empty");
  });
}
export function expectedCertificationFolioPlan(): Record<
  FacturaCertificationCaseId,
  number
> {
  return Object.fromEntries(
    CASES.map((item) => [item.caseId, item.folio]),
  ) as Record<FacturaCertificationCaseId, number>;
}
type PlanResolution = {
  folioByCase: Record<FacturaCertificationCaseId, number>;
  reused: boolean;
};
export function resolveCertificationFolioPlan(
  ledger: FolioSqliteLedger,
  issuer: string,
  idempotencyKey: string,
): PlanResolution {
  return atStage("reservation_reuse", "folio_plan", () => {
    const rows = CASES.map((item) => {
      const reservedCase = `${idempotencyKey}:${item.caseId}`;
      const row = ledger.db
        .prepare(
          "SELECT type_code,folio,state FROM folios WHERE issuer=? AND reserved_case=?",
        )
        .get(issuer, reservedCase) as
        { type_code: number; folio: number; state: string } | undefined;
      return { item, row };
    });
    const existing = rows.filter(({ row }) => row);
    if (existing.length > 0) {
      if (existing.length !== CASES.length)
        fail("reservation_reuse", "folio_plan.partial");
      for (const { item, row } of rows)
        if (
          !row ||
          row.state !== "reserved" ||
          row.type_code !== item.typeCode ||
          row.folio !== item.folio
        )
          fail("reservation_reuse", "folio_plan.mismatch");
      const extra = ledger.db
        .prepare(
          "SELECT COUNT(*) count FROM folios WHERE issuer=? AND reserved_case LIKE ?",
        )
        .get(issuer, `${idempotencyKey}:%`) as { count: number };
      if (extra.count !== CASES.length)
        fail("reservation_reuse", "folio_plan.extra");
      return { reused: true, folioByCase: expectedCertificationFolioPlan() };
    }
    const requests: AllocationRequest[] = CASES.map((item) => ({
      caseId: `${idempotencyKey}:${item.caseId}`,
      typeCode: item.typeCode,
    }));
    const allocated = ledger.reservePlan(issuer, requests);
    const folioByCase = Object.fromEntries(
      CASES.map((item) => [
        item.caseId,
        allocated[`${idempotencyKey}:${item.caseId}`],
      ]),
    ) as Record<FacturaCertificationCaseId, number>;
    if (CASES.some((item) => folioByCase[item.caseId] !== item.folio))
      fail("reservation_reuse", "folio_plan.assignment");
    return { reused: false, folioByCase };
  });
}
function assertContingencies(ledger: FolioSqliteLedger, issuer: string): void {
  for (const [typeCode, folio] of [
    [33, 5],
    [61, 4],
    [56, 2],
  ] as const) {
    const row = ledger.db
      .prepare(
        "SELECT state FROM folios WHERE issuer=? AND type_code=? AND folio=?",
      )
      .get(issuer, typeCode, folio) as { state: string } | undefined;
    if (row?.state !== "available") fail("reservation_reuse", "contingency");
  }
}
export function runCertificationGeneration<T>(
  generate: (onStage: (stage: FacturaSetDryRunStage) => void) => T,
  finalize: () => void,
): T {
  let currentStage: CertificationPrepareStage = "document_build";
  let result: T;
  try {
    result = generate((next) => {
      currentStage = next;
    });
  } catch (error) {
    throw wrap(error, currentStage, "generation");
  }
  atStage("ledger_finalize", "folio_state", finalize);
  return result;
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
  reservationReused: boolean;
  siiContacted: false;
  submitted: false;
  statusQueried: false;
} {
  if (
    env.DTE_MODE !== "certification" ||
    env.DTE_SII_ENV !== "certification" ||
    env.NODE_ENV === "production"
  )
    fail("preflight", "environment");
  if (
    env.DTE_SII_LIVE_AUTH === "true" ||
    env.DTE_SII_ENABLE_SUBMIT === "true" ||
    env.DTE_SII_ENABLE_STATUS === "true" ||
    env.DTE_SII_TOKEN ||
    env.DTE_TRACK_ID
  )
    fail("preflight", "external_operations");
  if (env.DTE_CERTIFICATION_SET_CONFIRM !== "PREPARE_SET_4959698_OFFLINE")
    fail("preflight", "confirmation");
  const idempotencyKey = required(
    env,
    "DTE_FACTURA_CERTIFICATION_IDEMPOTENCY_KEY",
  );
  if (!/^[A-Za-z0-9._-]{8,80}$/.test(idempotencyKey))
    fail("preflight", "idempotency_key");
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
  assertCertificationOutputPreflight(outputDir);
  const certificatePath = secureFile(env, "DTE_CERT_PATH", repoRoot);
  const privateKeyPath = secureFile(env, "DTE_PRIVATE_KEY_PATH", repoRoot);
  const external = atStage("preflight", "contract", () =>
    loadFacturaPreCafInputFromPath({
      inputPath: env.DTE_FACTURA_PRE_CAF_INPUT_PATH,
      repoRoot,
      env,
    }),
  );
  if (
    !external.ok ||
    external.input.issuer?.fechaResolucion !== "2026-05-23" ||
    external.input.issuer?.numeroResolucion !== 0
  )
    fail("preflight", "resolution");
  const audited = atStage("caf_bundle", "bundle", () =>
    loadAuditedRealCertificationCafs(env, repoRoot),
  );
  const contract = audited.cafs[0];
  const ledger = atStage(
    "ledger_open",
    "ledger",
    () => new FolioSqliteLedger(ledgerPath),
  );
  let plan: PlanResolution;
  try {
    atStage("ledger_open", "caf_import", () =>
      audited.cafs.forEach((caf) => ledger.importCaf(caf)),
    );
    plan = resolveCertificationFolioPlan(
      ledger,
      contract.issuerRut,
      idempotencyKey,
    );
    assertContingencies(ledger, contract.issuerRut);
    runCertificationGeneration(
      (onStage) =>
        runFacturaSetDryRun({
          env,
          repoRoot,
          outputDir,
          realCertification: { privateKeyPath, certificatePath },
          onStage,
          overrides: {
            folioByCase: plan.folioByCase,
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
        }),
      () =>
        ledger.markPlanIssued(
          contract.issuerRut,
          CASES.map((item) => `${idempotencyKey}:${item.caseId}`),
        ),
    );
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
    reservationReused: plan.reused,
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
export function formatCertificationSetPrepareError(error: unknown): string {
  const safe =
    error instanceof CertificationSetPrepareError
      ? error
      : new CertificationSetPrepareError("preflight", "internal", error);
  return [
    `code=${safe.code}`,
    `stage=${safe.stage}`,
    `field=${safe.field}`,
    "message=controlled_operation_failed",
  ].join("\n");
}
