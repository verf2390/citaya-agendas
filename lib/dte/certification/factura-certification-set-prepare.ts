import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
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

const REISSUE_CASES = [
  { caseId: "4959698-1", typeCode: 33, folio: 5 },
  { caseId: "4959698-2", typeCode: 33, folio: 6 },
  { caseId: "4959698-3", typeCode: 33, folio: 7 },
  { caseId: "4959698-4", typeCode: 33, folio: 8 },
  { caseId: "4959698-5", typeCode: 61, folio: 4 },
  { caseId: "4959698-6", typeCode: 61, folio: 5 },
  { caseId: "4959698-7", typeCode: 61, folio: 6 },
  { caseId: "4959698-8", typeCode: 56, folio: 2 },
] as const;
const REISSUE_FOLIOS = {
  "4959698-1": 5,
  "4959698-2": 6,
  "4959698-3": 7,
  "4959698-4": 8,
  "4959698-5": 4,
  "4959698-6": 5,
  "4959698-7": 6,
  "4959698-8": 2,
} as const;
const REISSUE_OUTPUT = "/home/verf/secure/dte-lab/set-4959698-reissue-001";
const REISSUE_PREVIOUS_ENVELOPE_SHA256 =
  "e8bfb70eb4113c0be7583c76414919ef7044cee944e2d14e52fb12d1e1f8240a";
const REISSUE_PREVIOUS_MANIFEST_SHA256 =
  "c11e5a0f196dcb83ec91b7648ec8ce4192956356584e74f24a1f9920b3c1f765";
const REISSUE_PREVIOUS_REGISTRY_SHA256 =
  "94d8647cd04b5414cb8d923458e9bf95c508de9eeae7f0bdb9ca59268a6e07ef";
const REISSUE_PREVIOUS_TRACK_ID = "0253276596";
const REISSUE_PREVIOUS_TRACK_FINGERPRINT = "f3bc8d8c157d4b83";
const REISSUE_CONFIRMATION =
  "REISSUE_SET_4959698_EPR_0253276596_TED-2-510_NEW_FOLIOS";
const REISSUE_NEW_CAF_IDENTITIES = new Set(["33:6-8", "61:5-6"]);

type Snapshot = { fingerprint: string; files: Array<{ file: string; sha256: string }> };
function sha256Bytes(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
function secureDirectory(path: string, repoRoot: string, field: string): string {
  const value = resolve(path);
  if (!isAbsolute(path) || inside(repoRoot, value)) fail("preflight", field);
  const stat = lstatSync(value);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(value) !== value ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o700
  )
    fail("preflight", field);
  return value;
}
function snapshotDirectory(path: string, repoRoot: string, field: string): Snapshot {
  const directory = secureDirectory(path, repoRoot, field);
  const files = readdirSync(directory)
    .sort()
    .map((file) => {
      const target = resolve(directory, file);
      const stat = lstatSync(target);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        realpathSync(target) !== target ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600
      )
        fail("preflight", field);
      return { file, sha256: sha256Bytes(readFileSync(target)) };
    });
  return { fingerprint: sha256Bytes(JSON.stringify(files)), files };
}
function snapshotsEqual(left: Snapshot, right: Snapshot): boolean {
  return left.fingerprint === right.fingerprint && JSON.stringify(left.files) === JSON.stringify(right.files);
}
function reissueFolioPlan(): Record<FacturaCertificationCaseId, number> {
  return { ...REISSUE_FOLIOS };
}
export function selectUniqueCertificationCaf<T extends {
  typeCode: number;
  rangeFrom: number;
  rangeTo: number;
}>(cafs: readonly T[], typeCode: number, folio: number): T {
  const matches = cafs.filter(
    (caf) => caf.typeCode === typeCode && caf.rangeFrom <= folio && caf.rangeTo >= folio,
  );
  if (matches.length !== 1) fail("caf_bundle", "coverage_unique");
  return matches[0];
}
function resolveReissueFolioPlan(
  ledger: FolioSqliteLedger,
  issuer: string,
  idempotencyKey: string,
): PlanResolution {
  return atStage("reservation_reuse", "reissue_folio_plan", () => {
    const rows = REISSUE_CASES.map((item) => ({
      item,
      row: ledger.db
        .prepare("SELECT type_code,folio,state FROM folios WHERE issuer=? AND reserved_case=?")
        .get(issuer, idempotencyKey + ":" + item.caseId) as
        | { type_code: number; folio: number; state: string }
        | undefined,
    }));
    const existing = rows.filter(({ row }) => row);
    if (existing.length) {
      if (
        existing.length !== REISSUE_CASES.length ||
        rows.some(({ item, row }) =>
          !row ||
          row.state !== "reserved" ||
          row.type_code !== item.typeCode ||
          row.folio !== item.folio,
        )
      )
        fail("reservation_reuse", "reissue_folio_plan.mismatch");
      return { folioByCase: reissueFolioPlan(), reused: true };
    }
    const allocated = ledger.reservePlan(
      issuer,
      REISSUE_CASES.map((item) => ({
        caseId: idempotencyKey + ":" + item.caseId,
        typeCode: item.typeCode,
      })),
    );
    if (
      REISSUE_CASES.some(
        (item) => allocated[idempotencyKey + ":" + item.caseId] !== item.folio,
      )
    )
      fail("reservation_reuse", "reissue_folio_plan.assignment");
    return { folioByCase: reissueFolioPlan(), reused: false };
  });
}
function maxBase64LineLength(xml: string): number {
  let maximum = 0;
  for (const match of xml.matchAll(/<(FRMT|SignatureValue|X509Certificate)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g))
    for (const line of match[2].split("\n")) maximum = Math.max(maximum, line.length);
  return maximum;
}
function xmlsecVerify(path: string, certificatePath: string, id?: string): boolean {
  const args = ["--verify", "--id-attr:ID", "Documento", "--id-attr:ID", "SetDTE", "--pubkey-cert-pem", certificatePath];
  if (id)
    args.push(
      "--node-xpath",
      "//*[local-name()='Signature'][.//*[local-name()='Reference' and @URI='#" + id + "']]",
    );
  args.push(path);
  return spawnSync("xmlsec1", args, { stdio: "ignore" }).status === 0;
}
function validateReissueOutput(
  outputDir: string,
  certificatePath: string,
  result: ReturnType<typeof runFacturaSetDryRun>,
): { envelopePath: string; envelopeSha256: string; manifestPath: string } {
  const envelopePath = resolve(outputDir, "EnvioDTE-4959698-CERTIFICATION.xml");
  const manifestPath = resolve(outputDir, "manifest-4959698-CERTIFICATION.json");
  const envelope = readFileSync(envelopePath);
  const xml = envelope.toString("latin1");
  const documentPaths = REISSUE_CASES.map((item) =>
    resolve(outputDir, item.caseId + "-DTE-CERTIFICATION.xml"),
  );
  const documentXml = documentPaths.map((path) => readFileSync(path, "latin1"));
  const documentIds = [...xml.matchAll(/<Documento\b[^>]*\bID="([^"]+)"/g)].map((match) => match[1]);
  const setId = xml.match(/<SetDTE\b[^>]*\bID="([^"]+)"/)?.[1] ?? "";
  const literalStandaloneXmlsecValid = documentPaths.filter((path) => xmlsecVerify(path, certificatePath)).length;
  const embeddedXmlsecValid = documentIds.filter((id) => xmlsecVerify(envelopePath, certificatePath, id)).length;
  const outerXmlsecValid = Boolean(setId) && xmlsecVerify(envelopePath, certificatePath, setId);
  const xsiPhysicallyDeclaredOnDte = documentXml.filter((value) =>
    /<DTE\b[^>]*\bxmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"/.test(value),
  ).length;
  if (
    result.cafCoverageUnique !== "8/8" ||
    result.tedFrmt !== "8/8" ||
    result.dteXsd !== "8/8" ||
    result.envioDteXsd !== "valid" ||
    result.references !== "valid" ||
    result.totals !== "valid" ||
    literalStandaloneXmlsecValid !== 8 ||
    embeddedXmlsecValid !== 8 ||
    !outerXmlsecValid ||
    xsiPhysicallyDeclaredOnDte !== 8 ||
    maxBase64LineLength(xml) > 76 ||
    envelope.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ||
    !xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>') ||
    !Buffer.from(xml, "latin1").equals(envelope)
  )
    fail("xsd_validation", "reissue_gates");
  return { envelopePath, envelopeSha256: sha256Bytes(envelope), manifestPath };
}

export function prepareFacturaCertificationSetReissue(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
) {
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
  if (
    required(env, "DTE_FACTURA_CERTIFICATION_REISSUE_NUMBER") !== "1" ||
    required(env, "DTE_FACTURA_CERTIFICATION_REISSUE_REASON_CODE") !== "TED-2-510" ||
    required(env, "DTE_FACTURA_CERTIFICATION_REISSUE_CONFIRM") !== REISSUE_CONFIRMATION
  )
    fail("preflight", "reissue_contract");
  const idempotencyKey = required(env, "DTE_FACTURA_CERTIFICATION_IDEMPOTENCY_KEY");
  if (idempotencyKey !== "SET-4959698-REISSUE-001")
    fail("preflight", "idempotency_key");
  const outputDir = externalPath(env, "DTE_FACTURA_CERTIFICATION_OUTPUT_DIR", repoRoot);
  if (outputDir !== REISSUE_OUTPUT) fail("preflight", "output");
  const ledgerPath = externalPath(env, "DTE_FACTURA_CERTIFICATION_LEDGER_PATH", repoRoot);
  assertCertificationOutputPreflight(outputDir);
  const certificatePath = secureFile(env, "DTE_CERT_PATH", repoRoot);
  const privateKeyPath = secureFile(env, "DTE_PRIVATE_KEY_PATH", repoRoot);
  const previousArtifactDir = secureDirectory(
    required(env, "DTE_FACTURA_CERTIFICATION_REISSUE_PREVIOUS_ARTIFACT_DIR"),
    repoRoot,
    "previous_artifacts",
  );
  const previousEnvelopePath = resolve(previousArtifactDir, "EnvioDTE-4959698-CERTIFICATION.xml");
  const previousManifestPath = resolve(previousArtifactDir, "manifest-4959698-CERTIFICATION.json");
  if (
    sha256Bytes(readFileSync(previousEnvelopePath)) !== REISSUE_PREVIOUS_ENVELOPE_SHA256 ||
    sha256Bytes(readFileSync(previousManifestPath)) !== REISSUE_PREVIOUS_MANIFEST_SHA256
  )
    fail("preflight", "previous_artifacts");
  const previousRegistryPath = externalPath(
    env,
    "DTE_FACTURA_CERTIFICATION_REISSUE_PREVIOUS_REGISTRY_PATH",
    repoRoot,
  );
  const previousRegistryBytes = readFileSync(previousRegistryPath);
  if (sha256Bytes(previousRegistryBytes) !== REISSUE_PREVIOUS_REGISTRY_SHA256)
    fail("preflight", "previous_registry");
  const previousRegistry = JSON.parse(previousRegistryBytes.toString("utf8")) as Record<string, unknown>;
  if (
    previousRegistry.envelopeSha256 !== REISSUE_PREVIOUS_ENVELOPE_SHA256 ||
    previousRegistry.state !== "submitted" ||
    previousRegistry.trackId !== REISSUE_PREVIOUS_TRACK_ID ||
    sha256Bytes(String(previousRegistry.trackId)).slice(0, 16) !== REISSUE_PREVIOUS_TRACK_FINGERPRINT
  )
    fail("preflight", "previous_registry");
  const registryDirs = required(
    env,
    "DTE_FACTURA_CERTIFICATION_REISSUE_PREVIOUS_REGISTRY_DIRS",
  )
    .split(":")
    .map((value) => value.trim())
    .filter(Boolean);
  if (registryDirs.length !== 2) fail("preflight", "previous_registries");
  const artifactBefore = snapshotDirectory(previousArtifactDir, repoRoot, "previous_artifacts");
  const registriesBefore = registryDirs.map((path) =>
    snapshotDirectory(path, repoRoot, "previous_registries"),
  );
  const externalInput = loadFacturaPreCafInputFromPath({
    inputPath: env.DTE_FACTURA_PRE_CAF_INPUT_PATH,
    repoRoot,
    env,
  });
  if (
    !externalInput.ok ||
    externalInput.input.issuer?.fechaResolucion !== "2026-05-23" ||
    externalInput.input.issuer?.numeroResolucion !== 0
  )
    fail("preflight", "resolution");
  const audited = atStage("caf_bundle", "bundle", () =>
    loadAuditedRealCertificationCafs(env, repoRoot),
  );
  for (const item of REISSUE_CASES)
    selectUniqueCertificationCaf(audited.cafs, item.typeCode, item.folio);
  const issuer = audited.cafs[0]?.issuerRut ?? fail("caf_bundle", "issuer");
  const ledger = atStage("ledger_open", "ledger", () => new FolioSqliteLedger(ledgerPath));
  let plan: PlanResolution;
  try {
    const previousIssued = ledger.db
      .prepare("SELECT type_code,folio,state,reserved_case,issued_at FROM folios WHERE issuer=? AND state='issued' ORDER BY type_code,folio")
      .all(issuer) as Array<Record<string, unknown>>;
    if (previousIssued.length !== 8) fail("ledger_open", "previous_issued");
    const imported = ledger.db
      .prepare("SELECT content_sha256 FROM caf_imports WHERE issuer=?")
      .all(issuer) as Array<{ content_sha256: string }>;
    const importedHashes = new Set(imported.map((row) => row.content_sha256));
    const missing = audited.cafs.filter((caf) => !importedHashes.has(caf.sha256));
    const missingIdentities = missing.map(
      (caf) => `${caf.typeCode}:${caf.rangeFrom}-${caf.rangeTo}`,
    );
    if (
      missing.length !== 2 ||
      new Set(missingIdentities).size !== 2 ||
      missingIdentities.some((identity) => !REISSUE_NEW_CAF_IDENTITIES.has(identity))
    )
      fail("ledger_open", "new_caf_ranges");
    atStage("ledger_open", "caf_import", () => missing.forEach((caf) => ledger.importCaf(caf)));
    plan = resolveReissueFolioPlan(ledger, issuer, idempotencyKey);
    const generation = runCertificationGeneration(
      () => {
        const result = runFacturaSetDryRun({
          env,
          repoRoot,
          outputDir,
          realCertification: { privateKeyPath, certificatePath },
          overrides: {
            folioByCase: plan.folioByCase,
            importedCafs: audited.cafs.map((caf) => ({
              typeCode: caf.typeCode,
              rangeFrom: caf.rangeFrom,
              rangeTo: caf.rangeTo,
              cafXml: caf.cafXml,
              privateKeyPem: caf.privateKeyPem,
              publicKeyPem: caf.publicKeyPem,
              sha256: caf.sha256,
            })),
            manifestMetadata: {
              artifactKind: "certification_set_reissue",
              reissueNumber: 1,
              reissueReasonCode: "TED-2-510",
              reissueOfEnvelopeSha256: REISSUE_PREVIOUS_ENVELOPE_SHA256,
              reissueOfManifestSha256: REISSUE_PREVIOUS_MANIFEST_SHA256,
              reissueOfRegistrySha256: REISSUE_PREVIOUS_REGISTRY_SHA256,
              reissueOfTrackIdFingerprint: REISSUE_PREVIOUS_TRACK_FINGERPRINT,
              reissueOfStatus: "EPR",
              foliosPlan: "33:5-8,61:4-6,56:2",
              folios: { "33": [5, 6, 7, 8], "61": [4, 5, 6], "56": [2] },
              previousArtifactSnapshotSha256: artifactBefore.fingerprint,
              previousRegistrySnapshotSha256: registriesBefore.map((item) => item.fingerprint),
              previousArtifactsUnchanged: true,
              previousRegistriesUnchanged: true,
            },
          },
        });
        const validated = validateReissueOutput(outputDir, certificatePath, result);
        if (
          !snapshotsEqual(artifactBefore, snapshotDirectory(previousArtifactDir, repoRoot, "previous_artifacts")) ||
          registriesBefore.some(
            (before, index) =>
              !snapshotsEqual(before, snapshotDirectory(registryDirs[index], repoRoot, "previous_registries")),
          )
        )
          fail("manifest_build", "append_only");
        const manifest = JSON.parse(readFileSync(validated.manifestPath, "utf8")) as Record<string, unknown>;
        Object.assign(manifest, {
          envelopeSha256: validated.envelopeSha256,
          officialFrmtValid: "8/8",
          xsiPhysicallyDeclaredOnDte: "8/8",
          literalStandaloneXmlsecValid: "8/8",
          embeddedXmlsecValid: "8/8",
          outerXmlsecValid: true,
          dteXsd: "8/8",
          envioDteXsd: "valid",
          references: "valid",
          totals: "valid",
          bom: "absent",
        });
        writeFileSync(validated.manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
        chmodSync(validated.manifestPath, 0o600);
        return { result, ...validated };
      },
      () =>
        ledger.markPlanIssued(
          issuer,
          REISSUE_CASES.map((item) => idempotencyKey + ":" + item.caseId),
        ),
    );
    const previousIssuedAfter = ledger.db
      .prepare("SELECT type_code,folio,state,reserved_case,issued_at FROM folios WHERE issuer=? AND state='issued' ORDER BY type_code,folio")
      .all(issuer) as Array<Record<string, unknown>>;
    const originalAfter = previousIssuedAfter.filter((row) =>
      !REISSUE_CASES.some(
        (item) => item.typeCode === row.type_code && item.folio === row.folio,
      ),
    );
    if (JSON.stringify(originalAfter) !== JSON.stringify(previousIssued))
      fail("ledger_finalize", "previous_issued_changed");
    const rows = ledger.db
      .prepare("SELECT state,reserved_case FROM folios WHERE issuer=?")
      .all(issuer) as Array<{ state: string; reserved_case: string | null }>;
    if (
      rows.filter((row) => row.state === "issued").length !== 16 ||
      rows.some((row) => row.state === "reserved" || row.state === "available")
    )
      fail("ledger_finalize", "reissue_states");
    return {
      status: "PREPARED_CERTIFICATION_REISSUE_OFFLINE" as const,
      artifactKind: "certification_set_reissue" as const,
      reissueNumber: 1 as const,
      reissueReasonCode: "TED-2-510" as const,
      documents: 8 as const,
      cafCoverageUnique: "8/8" as const,
      foliosPlan: "33:5-8,61:4-6,56:2" as const,
      officialFrmtValid: "8/8" as const,
      xsiPhysicallyDeclaredOnDte: "8/8" as const,
      literalStandaloneXmlsecValid: "8/8" as const,
      embeddedXmlsecValid: "8/8" as const,
      outerXmlsecValid: true as const,
      dteXsd: "8/8" as const,
      envioDteXsd: "valid" as const,
      references: "valid" as const,
      totals: "valid" as const,
      encoding: "ISO-8859-1" as const,
      bom: "absent" as const,
      previousArtifactsUnchanged: true as const,
      previousRegistriesUnchanged: true as const,
      reservationReused: plan.reused,
      envelopeSha256: generation.envelopeSha256,
      manifestPath: generation.manifestPath,
      envelopePath: generation.envelopePath,
      siiContacted: false as const,
      submitted: false as const,
      statusQueried: false as const,
    };
  } finally {
    ledger.close();
  }
}

export function formatCertificationSetReissue(
  result: ReturnType<typeof prepareFacturaCertificationSetReissue>,
): string {
  return Object.entries(result)
    .filter(([key]) => !["manifestPath", "envelopePath"].includes(key))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}
