#!/usr/bin/env node
import { createHash } from "node:crypto";
import { statSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, basename, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const phase = String(process.argv[2] ?? "");
if (!["inspect", "import", "dry-run", "generate", "inventory"].includes(phase)) {
  console.error("CAF_39_CERTIFICATION_ARTIFACTS_BLOCKED");
  console.error("cause=phase_invalid");
  process.exit(2);
}

function parseEnvFile(path) {
  const values = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function loadEnv(path, override = false) {
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid())
    throw new Error("DTE_CERTIFICATION_ENV_FILE_CUSTODY_INVALID");
  for (const [key, value] of Object.entries(parseEnvFile(path))) {
    if (override || process.env[key] === undefined) process.env[key] = value;
  }
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`DTE_CERTIFICATION_CONFIG_MISSING_${name}`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function chileTimestamp() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}`;
}

function artifactMetadata(path, kind, caseId) {
  const bytes = readFileSync(path);
  const stat = statSync(path);
  if ((stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid())
    throw new Error("DTE_CERTIFICATION_ARTIFACT_CUSTODY_INVALID");
  return {
    kind,
    ...(caseId ? { caseId } : {}),
    path,
    sha256: sha256(bytes),
    byteLength: bytes.length,
  };
}

function assertPrivateMaterialAbsent(paths) {
  for (const path of paths) {
    const text = readFileSync(path, "latin1");
    if (/<RSASK\b|<AUTORIZACION\b|BEGIN (?:RSA )?PRIVATE KEY/.test(text))
      throw new Error("DTE_CERTIFICATION_PRIVATE_MATERIAL_IN_ARTIFACT");
  }
}

loadEnv(resolve(repoRoot, ".env.local"));
loadEnv(resolve(repoRoot, ".env.dte-lab"), true);
loadEnv(
  process.env.DTE_BOLETA39_ISSUER_ENV ??
    "/home/verf/secure/dte-lab/issuer-certification.env",
  true,
);
Object.assign(process.env, {
  DTE_MODE: "certification",
  DTE_SII_ENV: "certification",
  DTE_SII_ENABLE_SUBMIT: "false",
  DTE_SII_ENABLE_STATUS: "false",
  DTE_SII_LIVE_AUTH: "false",
  DTE_PRODUCTION_ENABLED: "false",
  DTE_AUTOMATIC_ISSUANCE_ENABLED: "false",
});
delete process.env.DTE_SII_TOKEN;
delete process.env.DTE_TRACK_ID;

const { createClient } = require("@supabase/supabase-js");
const {
  loadAuthorizedBoleta39CertificationCaf,
} = require(resolve(repoRoot, "lib/dte/certification/boleta39-certification-caf.ts"));
const {
  SupabaseBoleta39CertificationRepository,
} = require(resolve(repoRoot, "lib/dte/certification/boleta39-certification-repository.ts"));
const {
  prepareRealBoleta39Certification,
} = require(resolve(repoRoot, "lib/dte/certification/boleta-pre-caf.ts"));

const cafRoot = required("DTE_BOLETA39_CAF_ROOT");
const authorizedCaf = loadAuthorizedBoleta39CertificationCaf({
  manifestPath: required("DTE_BOLETA39_AUTHORIZATION_MANIFEST"),
  cafRoot,
  repoRoot,
});
const authorization = authorizedCaf.authorization;
const client = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const repository = new SupabaseBoleta39CertificationRepository(client);
const importInput = {
  tenantId: authorization.tenantId,
  environment: "certification",
  documentType: 39,
  issuerRut: authorization.issuerRut,
  cafSha256: authorizedCaf.sha256,
  securePath: authorization.cafPath,
  idk: authorization.idk,
  rangeFrom: authorization.rangeFrom,
  rangeTo: authorization.rangeTo,
  authorizationDate: authorization.authorizationDate,
  frmaVerificationStatus: authorization.frmaVerificationStatus,
  exceptionReason: authorization.reason,
  exceptionActorId: authorization.actorId,
  exceptionAuthorizedAt: authorization.authorizedAt,
};
const outputDir = resolve(
  process.env.DTE_BOLETA39_OUTPUT_DIR ??
    join(cafRoot, "artifacts", `boleta39-${authorization.authorizationDate}`),
);
const idempotencyKey = `boleta39-certification-${authorization.authorizationDate}-${authorizedCaf.sha256}`;

function issuer() {
  return {
    rut: required("DTE_ISSUER_RUT"),
    legalName: required("DTE_ISSUER_RAZON_SOCIAL"),
    businessActivity: required("DTE_ISSUER_GIRO"),
    address: required("DTE_ISSUER_DIRECCION"),
    commune: required("DTE_ISSUER_COMUNA"),
    city: required("DTE_ISSUER_CIUDAD"),
    resolutionDate:
      process.env.DTE_CERTIFICATION_RESOLUTION_DATE ?? authorization.authorizationDate,
    resolutionNumber: process.env.DTE_CERTIFICATION_RESOLUTION_NUMBER ?? "0",
    senderRut: process.env.DTE_CERT_REPRESENTATIVE_RUT ?? required("DTE_ISSUER_RUT"),
  };
}

function generatorInput(directory) {
  return {
    tenantId: authorization.tenantId,
    issueDate: authorization.authorizationDate,
    firstFolio: 1,
    outputDir: directory,
    issuer: issuer(),
    cafXml: authorizedCaf.cafXml,
    cafPrivateKeyPem: authorizedCaf.cafPrivateKeyPem,
    cafPublicKeyPem: authorizedCaf.cafPublicKeyPem,
    certificatePath: required("DTE_CERT_PATH"),
    privateKeyPath: required("DTE_PRIVATE_KEY_PATH"),
    generationTimestamp: chileTimestamp(),
  };
}

try {
  if (phase === "inspect") {
    console.log("environment=certification");
    console.log("documentType=39");
    console.log("range=1-5");
    console.log(`cafSha256=${authorizedCaf.sha256}`);
    console.log(`frmaVerificationStatus=${authorization.frmaVerificationStatus}`);
    console.log("siiContacted=false");
  } else if (phase === "inventory") {
    const inventory = await repository.inventory(authorization.tenantId);
    console.log(`inventory=${JSON.stringify(inventory)}`);
    console.log("siiContacted=false");
  } else if (phase === "import") {
    const first = await repository.importCaf(importInput);
    const replay = await repository.importCaf(importInput);
    if (first.replayed || !replay.replayed || first.cafId !== replay.cafId || replay.folioCount !== 5)
      throw new Error("DTE_CERTIFICATION_CAF_IDEMPOTENCY_FAILED");
    console.log("cafCount=1");
    console.log("folioCount=5");
    console.log("importReplay=true");
    console.log("siiContacted=false");
  } else if (phase === "dry-run") {
    const directory = resolve(`${outputDir}.dry-run`);
    rmSync(directory, { recursive: true, force: true });
    try {
      const result = await prepareRealBoleta39Certification(generatorInput(directory));
      if (result.rvdTotals.totalAmount !== 54_160 || result.artifacts.length !== 7)
        throw new Error("DTE_CERTIFICATION_DRY_RUN_INVALID");
      console.log("dryRun=validated");
      console.log("folioWrites=0");
      console.log("xsdBoletas=5/5");
      console.log("xsdEnvelope=valid");
      console.log("xsdRcof=valid");
      console.log("signatures=12/12");
      console.log("siiContacted=false");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  } else if (phase === "generate") {
    mkdirSync(dirname(outputDir), { recursive: true, mode: 0o700 });
    chmodSync(dirname(outputDir), 0o700);
    const imported = await repository.importCaf(importInput);
    if (!imported.replayed || imported.folioCount !== 5)
      throw new Error("DTE_CERTIFICATION_IMPORT_REQUIRED");
    const run = await repository.beginRun({
      tenantId: authorization.tenantId,
      cafId: imported.cafId,
      idempotencyKey,
      actorId: authorization.actorId,
    });
    if (run.replayed) throw new Error("DTE_CERTIFICATION_GENERATION_ALREADY_ATTEMPTED");
    let validated = false;
    try {
      const generationInput = generatorInput(outputDir);
      const result = await prepareRealBoleta39Certification(generationInput);
      assertPrivateMaterialAbsent(result.artifacts.map((item) => item.path));
      const reportPath = join(outputDir, "REPORT-SANITIZED.json");
      const report = {
        status: result.status,
        environment: "certification",
        documentType: 39,
        range: { from: 1, to: 5 },
        frmaVerificationStatus: authorization.frmaVerificationStatus,
        siiContacted: false,
        productionFoliosUsed: false,
        cases: result.documents.map((item) => ({
          caseId: item.caseId,
          folio: item.folio,
          total: item.totals.totalAmount,
        })),
        totals: result.rvdTotals,
        xsd: result.xsd,
        signatures: result.signatures,
        generatedAtChile: generationInput.generationTimestamp,
        xmlArtifacts: result.artifacts.map((item) => ({
          name: basename(item.path),
          sha256: item.sha256,
          byteLength: item.byteLength,
        })),
      };
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      chmodSync(reportPath, 0o600);
      const reportArtifact = artifactMetadata(reportPath, "sanitized_report");
      const manifestPath = join(outputDir, "SHA256SUMS");
      const manifestEntries = [...result.artifacts, reportArtifact]
        .map((item) => `${item.sha256}  ${basename(item.path)}`)
        .sort();
      writeFileSync(manifestPath, `${manifestEntries.join("\n")}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      chmodSync(manifestPath, 0o600);
      const manifestArtifact = artifactMetadata(manifestPath, "sha256_manifest");
      const artifacts = [...result.artifacts, reportArtifact, manifestArtifact];
      await repository.validateRun({
        tenantId: authorization.tenantId,
        runId: run.runId,
        artifacts,
        finalHashes: Object.fromEntries(
          artifacts.map((item) => [basename(item.path), item.sha256]),
        ),
      });
      validated = true;
      const replay = await repository.beginRun({
        tenantId: authorization.tenantId,
        cafId: imported.cafId,
        idempotencyKey,
        actorId: authorization.actorId,
      });
      if (!replay.replayed || replay.runId !== run.runId || replay.status !== "validated")
        throw new Error("DTE_CERTIFICATION_RUN_IDEMPOTENCY_FAILED");
      console.log(`outputDir=${outputDir}`);
      for (const item of artifacts)
        console.log(`artifact=${basename(item.path)} bytes=${item.byteLength} sha256=${item.sha256}`);
      console.log("runReplay=true");
      console.log("generatedFolios=5");
      console.log("siiContacted=false");
      console.log("CAF_39_CERTIFICATION_ARTIFACTS_READY_FOR_MANUAL_UPLOAD");
    } catch (error) {
      if (!validated)
        await repository.failRun(
          authorization.tenantId,
          run.runId,
          error instanceof Error ? error.message : "unknown_generation_error",
        );
      throw error;
    }
  }
} catch (error) {
  console.error("CAF_39_CERTIFICATION_ARTIFACTS_BLOCKED");
  console.error(`cause=${error instanceof Error ? error.message : "unknown_error"}`);
  process.exit(1);
}
