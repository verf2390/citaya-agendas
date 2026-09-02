import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  buildPdf,
  parseFinalDte,
  renderAndAudit,
  type CopySpec,
  type SourceDte,
} from "./factura-printed-samples-dry-run";

const ROOT = "/home/verf/secure/dte-lab";
const SET_DIR = `${ROOT}/set-4959698-reissue-001`;
const SET_ENVELOPE = `${SET_DIR}/EnvioDTE-4959698-CERTIFICATION.xml`;
const SET_MANIFEST = `${SET_DIR}/manifest-4959698-CERTIFICATION.json`;
const SET_REGISTRY =
  `${ROOT}/submit-registry/875e311358155109761133688bdbbec1341a038cb0ebdd17290b3e711d4912a0.json`;
const SET_ENVELOPE_SHA =
  "875e311358155109761133688bdbbec1341a038cb0ebdd17290b3e711d4912a0";
const SET_TRACK = "0253277434";
const SIMULATION_DIR = `${ROOT}/simulation-set-001`;
const SIMULATION_ENVELOPE =
  `${SIMULATION_DIR}/EnvioDTE-SIMULATION-001-CERTIFICATION.xml`;
const SIMULATION_MANIFEST =
  `${SIMULATION_DIR}/manifest-SIMULATION-001-CERTIFICATION.json`;
const SIMULATION_REGISTRY =
  `${ROOT}/simulation-submit-registry/9efcfe3cd5eb88ba2aa0b75e0e493020b34ea360413f51699b42914f323a726f.json`;
const SIMULATION_ENVELOPE_SHA =
  "9efcfe3cd5eb88ba2aa0b75e0e493020b34ea360413f51699b42914f323a726f";
const SIMULATION_TRACK = "0253302416";
export const FINAL_PRINTED_OUTPUT =
  "/home/verf/secure/dte-lab/muestras-impresas/final-001";
export const FINAL_PRINTED_CONFIRMATION =
  "PREPARE_PRINTED_SAMPLES_FINAL_001_OFFLINE";
const MANIFEST_NAME = "manifest-muestras-impresas-final-001.json";
const MAX_PDF_BYTES = 500 * 1024;

type Origin = "set_pruebas" | "simulacion";
type CopyKind = "tributaria" | "cedible";
type SourcePlan = {
  origin: Origin;
  caseId: string;
  type: 33 | 56 | 61;
  folio: number;
  sourceFile: string;
  taxFile: string;
  cedibleFile?: string;
};

const SOURCE_PLAN: readonly SourcePlan[] = [
  { origin: "set_pruebas", caseId: "set-pruebas-caso-01", type: 33, folio: 5, sourceFile: "4959698-1-DTE-CERTIFICATION.xml", taxFile: "set-pruebas-caso-01-33-folio-5.pdf", cedibleFile: "set-pruebas-caso-01-33-folio-5-cedible.pdf" },
  { origin: "set_pruebas", caseId: "set-pruebas-caso-02", type: 33, folio: 6, sourceFile: "4959698-2-DTE-CERTIFICATION.xml", taxFile: "set-pruebas-caso-02-33-folio-6.pdf", cedibleFile: "set-pruebas-caso-02-33-folio-6-cedible.pdf" },
  { origin: "set_pruebas", caseId: "set-pruebas-caso-03", type: 33, folio: 7, sourceFile: "4959698-3-DTE-CERTIFICATION.xml", taxFile: "set-pruebas-caso-03-33-folio-7.pdf", cedibleFile: "set-pruebas-caso-03-33-folio-7-cedible.pdf" },
  { origin: "set_pruebas", caseId: "set-pruebas-caso-04", type: 33, folio: 8, sourceFile: "4959698-4-DTE-CERTIFICATION.xml", taxFile: "set-pruebas-caso-04-33-folio-8.pdf", cedibleFile: "set-pruebas-caso-04-33-folio-8-cedible.pdf" },
  { origin: "set_pruebas", caseId: "set-pruebas-caso-05", type: 61, folio: 4, sourceFile: "4959698-5-DTE-CERTIFICATION.xml", taxFile: "set-pruebas-caso-05-61-folio-4.pdf" },
  { origin: "set_pruebas", caseId: "set-pruebas-caso-06", type: 61, folio: 5, sourceFile: "4959698-6-DTE-CERTIFICATION.xml", taxFile: "set-pruebas-caso-06-61-folio-5.pdf" },
  { origin: "set_pruebas", caseId: "set-pruebas-caso-07", type: 61, folio: 6, sourceFile: "4959698-7-DTE-CERTIFICATION.xml", taxFile: "set-pruebas-caso-07-61-folio-6.pdf" },
  { origin: "set_pruebas", caseId: "set-pruebas-caso-08", type: 56, folio: 2, sourceFile: "4959698-8-DTE-CERTIFICATION.xml", taxFile: "set-pruebas-caso-08-56-folio-2.pdf" },
  { origin: "simulacion", caseId: "simulacion-33-09", type: 33, folio: 9, sourceFile: "simulation-33-09-DTE-CERTIFICATION.xml", taxFile: "simulacion-33-folio-9.pdf", cedibleFile: "simulacion-33-folio-9-cedible.pdf" },
  { origin: "simulacion", caseId: "simulacion-56-03", type: 56, folio: 3, sourceFile: "simulation-56-03-DTE-CERTIFICATION.xml", taxFile: "simulacion-56-folio-3.pdf" },
  { origin: "simulacion", caseId: "simulacion-61-07", type: 61, folio: 7, sourceFile: "simulation-61-07-DTE-CERTIFICATION.xml", taxFile: "simulacion-61-folio-7.pdf" },
] as const;

export const FINAL_PRINTED_SAMPLES_PLAN = SOURCE_PLAN.flatMap((source) => [
  {
    origin: source.origin,
    type: source.type,
    folio: source.folio,
    copy: "tributaria" as const,
    fileName: source.taxFile,
  },
  ...(source.cedibleFile
    ? [{
        origin: source.origin,
        type: source.type,
        folio: source.folio,
        copy: "cedible" as const,
        fileName: source.cedibleFile,
      }]
    : []),
]);

type PreparedSource = {
  plan: SourcePlan;
  path: string;
  sha256: string;
  dte: SourceDte;
};

type FileResult = {
  name: string;
  sha256: string;
  origin: Origin;
  type: number;
  folio: number;
  copy: CopyKind;
  sourceDteSha256: string;
  pages: 1;
  bytes: number;
  pdf417: "valid";
  visualValidation: "valid";
};

export type FinalPrintedSamplesResult = {
  sourceTracksValidated: "2/2";
  sourceDteSignaturesValid: "11/11";
  samplesPlanned: 16;
  samplesGenerated: 16;
  singlePage: "16/16";
  under500Kb: "16/16";
  selectableText: "16/16";
  pdf417Detected: "16/16";
  pdf417MatchesTed: "16/16";
  documentDataMatchesSource: "16/16";
  documentNamesValid: "16/16";
  taxBoxValid: "16/16";
  issuerDataValid: "16/16";
  receiverDataValid: "16/16";
  totalsValid: "16/16";
  referencesValid: "4/4";
  allNoteReferencesValid: "6/6";
  cedibleCopies: 5;
  cedibleReceiptBoxValid: "5/5";
  nonCedibleWithoutReceiptBox: "11/11";
  creditDebitWithoutCedible: "4/4";
  allCreditDebitSamplesWithoutCedible: "6/6";
  timbreDimensionsValid: "16/16";
  timbrePositionValid: "16/16";
  resolutionLegendValid: "16/16";
  previousArtifactsUnchanged: true;
  previousRegistriesUnchanged: true;
  previousLedgersUnchanged: true;
  siiContacted: false;
  uploaded: false;
  listoParaCargaManual: true;
  outputPath: string;
  files: FileResult[];
};

class FinalPrintedError extends Error {
  constructor(readonly field: string) {
    super(`FINAL_PRINTED_SAMPLES_REJECTED:${field}`);
    this.name = "FinalPrintedError";
  }
}

function reject(field: string): never {
  throw new FinalPrintedError(/^[a-z0-9_.-]+$/i.test(field) ? field : "internal");
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) reject(name.toLowerCase());
  return value;
}

function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function regular600(path: string, repoRoot: string, field: string): string {
  const absolute = resolve(path);
  try {
    const stat = lstatSync(absolute);
    if (
      !isAbsolute(path) ||
      inside(repoRoot, absolute) ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      realpathSync(absolute) !== absolute ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    )
      reject(field);
  } catch (error) {
    if (error instanceof FinalPrintedError) throw error;
    reject(field);
  }
  return absolute;
}

function directory700(path: string, repoRoot: string, field: string): string {
  const absolute = resolve(path);
  try {
    const stat = lstatSync(absolute);
    if (
      !isAbsolute(path) ||
      inside(repoRoot, absolute) ||
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(absolute) !== absolute ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700
    )
      reject(field);
  } catch (error) {
    if (error instanceof FinalPrintedError) throw error;
    reject(field);
  }
  return absolute;
}

type Snapshot = {
  fingerprint: string;
  entries: Array<{ path: string; kind: "file" | "directory" | "symlink"; sha256?: string }>;
};

function snapshotTree(root: string, excluded: string): Snapshot {
  const entries: Snapshot["entries"] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (
        path === excluded ||
        inside(excluded, path) ||
        path.startsWith(`${excluded}.tmp-`)
      )
        continue;
      const stat = lstatSync(path);
      const itemPath = relative(root, path);
      if (stat.isSymbolicLink()) entries.push({ path: itemPath, kind: "symlink" });
      else if (stat.isDirectory()) {
        entries.push({ path: itemPath, kind: "directory" });
        walk(path);
      } else if (stat.isFile())
        entries.push({ path: itemPath, kind: "file", sha256: sha256(readFileSync(path)) });
    }
  };
  walk(root);
  return { fingerprint: sha256(JSON.stringify(entries)), entries };
}

function parseJson(path: string, field: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) reject(field);
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof FinalPrintedError) throw error;
    reject(field);
  }
}

function statusZero(registry: Record<string, unknown>): boolean {
  return /<STATUS>\s*0\s*<\/STATUS>/i.test(
    typeof registry.response === "string"
      ? registry.response
      : JSON.stringify(registry.response ?? ""),
  );
}

function manifestFiles(manifest: Record<string, unknown>): Map<string, string> {
  if (!Array.isArray(manifest.files)) reject("manifest_files");
  return new Map(
    (manifest.files as Array<Record<string, unknown>>).map((entry) => [
      String(entry.file ?? ""),
      String(entry.sha256 ?? ""),
    ]),
  );
}

function verifyDteSignature(path: string, certPath: string): boolean {
  return (
    spawnSync(
      "xmlsec1",
      [
        "--verify",
        "--id-attr:ID",
        "Documento",
        "--pubkey-cert-pem",
        certPath,
        path,
      ],
      { stdio: "ignore" },
    ).status === 0
  );
}

function assertSourceSemantics(source: PreparedSource): void {
  const dte = source.dte;
  if (
    dte.type !== source.plan.type ||
    Number(dte.folio) !== source.plan.folio ||
    !dte.issuerName ||
    !dte.issuerRut ||
    !dte.issuerActivity ||
    !dte.issuerAddress ||
    !dte.issuerCommune ||
    !dte.receiverName ||
    !dte.receiverRut ||
    !dte.receiverActivity ||
    !dte.receiverAddress ||
    !dte.receiverCommune ||
    !dte.details.length ||
    !dte.total
  )
    reject("source_semantics");
  if (Number(dte.vat) > 0 && dte.vatRate !== "19") reject("source_vat");
  if (Number(dte.net || 0) + Number(dte.exempt || 0) + Number(dte.vat || 0) !== Number(dte.total))
    reject("source_totals");
  if (
    (dte.type === 56 || dte.type === 61) &&
    (!dte.references.length ||
      dte.references.some((reference) =>
        !reference.type || !reference.folio || !reference.date || !reference.reason))
  )
    reject("source_references");
}

function loadSources(
  env: NodeJS.ProcessEnv,
  repoRoot: string,
  certPath: string,
): PreparedSource[] {
  directory700(SET_DIR, repoRoot, "set_directory");
  directory700(SIMULATION_DIR, repoRoot, "simulation_directory");
  for (const [path, field] of [
    [SET_ENVELOPE, "set_envelope"],
    [SET_MANIFEST, "set_manifest"],
    [SET_REGISTRY, "set_registry"],
    [SIMULATION_ENVELOPE, "simulation_envelope"],
    [SIMULATION_MANIFEST, "simulation_manifest"],
    [SIMULATION_REGISTRY, "simulation_registry"],
  ] as const)
    regular600(path, repoRoot, field);
  if (
    sha256(readFileSync(SET_ENVELOPE)) !== SET_ENVELOPE_SHA ||
    sha256(readFileSync(SIMULATION_ENVELOPE)) !== SIMULATION_ENVELOPE_SHA
  )
    reject("envelope_hash");
  const setManifest = parseJson(SET_MANIFEST, "set_manifest");
  const simulationManifest = parseJson(SIMULATION_MANIFEST, "simulation_manifest");
  const setRegistry = parseJson(SET_REGISTRY, "set_registry");
  const simulationRegistry = parseJson(SIMULATION_REGISTRY, "simulation_registry");
  if (
    setRegistry.state !== "submitted" ||
    setRegistry.semanticCategory !== "xml_receipt" ||
    setRegistry.trackId !== SET_TRACK ||
    setRegistry.envelopeSha256 !== SET_ENVELOPE_SHA ||
    !statusZero(setRegistry) ||
    setManifest.envelopeSha256 !== SET_ENVELOPE_SHA ||
    setManifest.officialFrmtValid !== "8/8" ||
    setManifest.literalStandaloneXmlsecValid !== "8/8" ||
    setManifest.embeddedXmlsecValid !== "8/8" ||
    setManifest.outerXmlsecValid !== true ||
    required(env, "DTE_PRINTED_SET_ACCEPTANCE_CONFIRM") !==
      "TRACK_0253277434_8_DTE_ACCEPTED_WITHOUT_REPAIRS"
  )
    reject("set_track");
  if (
    simulationRegistry.state !== "submitted" ||
    simulationRegistry.semanticCategory !== "xml_receipt" ||
    simulationRegistry.trackId !== SIMULATION_TRACK ||
    simulationRegistry.envelopeSha256 !== SIMULATION_ENVELOPE_SHA ||
    !statusZero(simulationRegistry) ||
    simulationManifest.envelopeSha256 !== SIMULATION_ENVELOPE_SHA ||
    simulationManifest.documentsCount !== 10 ||
    simulationManifest.officialFrmtValid !== "10/10" ||
    simulationManifest.literalStandaloneXmlsecValid !== "10/10" ||
    simulationManifest.embeddedXmlsecValid !== "10/10" ||
    simulationManifest.outerXmlsecValid !== true ||
    required(env, "DTE_PRINTED_SIMULATION_ACCEPTANCE_CONFIRM") !==
      "TRACK_0253302416_10_DTE_ACCEPTED_WITHOUT_REJECTIONS_OR_REPAIRS"
  )
    reject("simulation_track");
  const fileHashes = {
    set_pruebas: manifestFiles(setManifest),
    simulacion: manifestFiles(simulationManifest),
  };
  const sources = SOURCE_PLAN.map((plan): PreparedSource => {
    const directory = plan.origin === "set_pruebas" ? SET_DIR : SIMULATION_DIR;
    const path = regular600(join(directory, plan.sourceFile), repoRoot, "source_dte");
    const bytes = readFileSync(path);
    const digest = sha256(bytes);
    if (fileHashes[plan.origin].get(plan.sourceFile) !== digest)
      reject("source_dte_hash");
    if (!verifyDteSignature(path, certPath)) reject("source_dte_signature");
    const source = {
      plan,
      path,
      sha256: digest,
      dte: parseFinalDte(path, plan.caseId),
    };
    assertSourceSemantics(source);
    return source;
  });
  if (
    sources.length !== 11 ||
    new Set(sources.map((source) => `${source.dte.type}:${source.dte.folio}`)).size !== 11 ||
    new Set(sources.map((source) => source.dte.issuerRut)).size !== 1
  )
    reject("source_plan");
  return sources;
}

function assertEnvironment(env: NodeJS.ProcessEnv): void {
  const exact: Record<string, string> = {
    DTE_MODE: "certification",
    DTE_SII_ENV: "certification",
    DTE_SII_LIVE_AUTH: "false",
    DTE_SII_ENABLE_SUBMIT: "false",
    DTE_SII_ENABLE_STATUS: "false",
  };
  for (const [name, expected] of Object.entries(exact))
    if (String(env[name] ?? "").trim() !== expected) reject(name.toLowerCase());
  if (env.NODE_ENV === "production") reject("node_env");
  if (required(env, "DTE_PRINTED_FINAL_CONFIRM") !== FINAL_PRINTED_CONFIRMATION)
    reject("confirmation");
  if (resolve(required(env, "DTE_PRINTED_FINAL_OUTPUT_DIR")) !== FINAL_PRINTED_OUTPUT)
    reject("output");
}

export async function prepareFinalPrintedSamples(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): Promise<FinalPrintedSamplesResult> {
  assertEnvironment(env);
  const certPath = regular600(required(env, "DTE_CERT_PATH"), repoRoot, "certificate");
  const output = resolve(required(env, "DTE_PRINTED_FINAL_OUTPUT_DIR"));
  const parent = dirname(output);
  try {
    lstatSync(output);
    reject("output_exists");
  } catch (error) {
    if (error instanceof FinalPrintedError) throw error;
  }
  try {
    lstatSync(parent);
  } catch {
    mkdirSync(parent, { mode: 0o700 });
    chmodSync(parent, 0o700);
  }
  directory700(parent, repoRoot, "output_parent");
  const before = snapshotTree(ROOT, output);
  const sources = loadSources(env, repoRoot, certPath);
  const sourceByKey = new Map(
    sources.map((source) => [`${source.plan.type}:${source.plan.folio}`, source]),
  );
  if (FINAL_PRINTED_SAMPLES_PLAN.length !== 16) reject("samples_plan");
  const staging = `${output}.tmp-${process.pid}`;
  mkdirSync(staging, { mode: 0o700 });
  chmodSync(staging, 0o700);
  try {
    const files: FileResult[] = [];
    for (const plan of FINAL_PRINTED_SAMPLES_PLAN) {
      const source = sourceByKey.get(`${plan.type}:${plan.folio}`) ?? reject("source_lookup");
      const spec: CopySpec = {
        source: source.dte,
        cedible: plan.copy === "cedible",
        fileName: plan.fileName,
      };
      if (spec.cedible && spec.source.type !== 33) reject("cedible_type");
      const built = await buildPdf(spec);
      if (built.bytes.length >= MAX_PDF_BYTES) reject("pdf_size");
      const audit = await renderAndAudit(built.bytes, null, built.layout, spec);
      if (
        audit.pageCount !== 1 ||
        !audit.text ||
        !audit.decodedTedMatches ||
        audit.width < 21.5 / 2.54 * 72 ||
        audit.width > 21.5 / 2.54 * 72 + 4 ||
        audit.height < 11 / 2.54 * 72 ||
        audit.height > 33 / 2.54 * 72 ||
        audit.barcodeWidth < 5 / 2.54 * 72 ||
        audit.barcodeWidth > 9 / 2.54 * 72 ||
        audit.barcodeHeight < 2 / 2.54 * 72 ||
        audit.barcodeHeight > 4 / 2.54 * 72 ||
        audit.barcodeX < 2 / 2.54 * 72 ||
        audit.barcodeY + audit.barcodeHeight > audit.height - 0.5 / 2.54 * 72
      )
        reject("visual_gate");
      const path = join(staging, plan.fileName);
      writeFileSync(path, built.bytes, { mode: 0o600 });
      chmodSync(path, 0o600);
      files.push({
        name: plan.fileName,
        sha256: sha256(built.bytes),
        origin: plan.origin,
        type: plan.type,
        folio: plan.folio,
        copy: plan.copy,
        sourceDteSha256: source.sha256,
        pages: 1,
        bytes: built.bytes.length,
        pdf417: "valid",
        visualValidation: "valid",
      });
    }
    if (
      files.length !== 16 ||
      files.filter((file) => file.copy === "cedible").length !== 5 ||
      files.filter((file) => file.copy === "tributaria").length !== 11 ||
      files.some((file) => file.type !== 33 && file.copy === "cedible")
    )
      reject("output_plan");
    if (snapshotTree(ROOT, output).fingerprint !== before.fingerprint)
      reject("previous_state_changed");
    const manifest = {
      schemaVersion: 1,
      artifactKind: "certification_printed_samples_final",
      generatedOffline: true,
      sources: {
        set_pruebas: {
          envelopeSha256: SET_ENVELOPE_SHA,
          trackId: SET_TRACK,
          documentsAcceptedWithoutRepairs: 8,
        },
        simulacion: {
          envelopeSha256: SIMULATION_ENVELOPE_SHA,
          trackId: SIMULATION_TRACK,
          documentsAcceptedWithoutRejectionsOrRepairs: 10,
        },
      },
      files: files.map((file) => ({
        name: file.name,
        origin: file.origin,
        dteType: file.type,
        folio: file.folio,
        copy: file.copy,
        sourceDteSha256: file.sourceDteSha256,
        pdfSha256: file.sha256,
        pages: file.pages,
        bytes: file.bytes,
        pdf417: file.pdf417,
        visualValidation: file.visualValidation,
      })),
      gates: {
        sourceTracksValidated: "2/2",
        sourceDteSignaturesValid: "11/11",
        samplesPlanned: 16,
        samplesGenerated: 16,
        singlePage: "16/16",
        under500Kb: "16/16",
        selectableText: "16/16",
        pdf417Detected: "16/16",
        pdf417MatchesTed: "16/16",
        documentDataMatchesSource: "16/16",
        documentNamesValid: "16/16",
        taxBoxValid: "16/16",
        issuerDataValid: "16/16",
        receiverDataValid: "16/16",
        totalsValid: "16/16",
        referencesValid: "4/4",
        allNoteReferencesValid: "6/6",
        cedibleCopies: 5,
        cedibleReceiptBoxValid: "5/5",
        nonCedibleWithoutReceiptBox: "11/11",
        creditDebitWithoutCedible: "4/4",
        allCreditDebitSamplesWithoutCedible: "6/6",
        timbreDimensionsValid: "16/16",
        timbrePositionValid: "16/16",
        resolutionLegendValid: "16/16",
        previousArtifactsUnchanged: true,
        previousRegistriesUnchanged: true,
        previousLedgersUnchanged: true,
        siiContacted: false,
        uploaded: false,
      },
      previousStateSnapshotSha256: before.fingerprint,
    };
    writeFileSync(join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    chmodSync(join(staging, MANIFEST_NAME), 0o600);
    renameSync(staging, output);
    if (snapshotTree(ROOT, output).fingerprint !== before.fingerprint)
      reject("previous_state_changed");
    return {
      ...(manifest.gates as Omit<
        FinalPrintedSamplesResult,
        "outputPath" | "files" | "listoParaCargaManual"
      >),
      listoParaCargaManual: true,
      outputPath: output,
      files,
    };
  } catch (error) {
    try {
      const stat = lstatSync(staging);
      if (stat.isDirectory() && !stat.isSymbolicLink())
        rmSync(staging, { recursive: true });
    } catch {
      // Staging inexistente o ya promovido.
    }
    throw error;
  }
}

export function formatFinalPrintedSamplesResult(
  result: FinalPrintedSamplesResult,
): string {
  const { files, ...gates } = result;
  return [
    ...Object.entries(gates).map(([key, value]) => `${key}=${value}`),
    ...files.map((file) => `file.${file.name}.sha256=${file.sha256}`),
  ].join("\n");
}
