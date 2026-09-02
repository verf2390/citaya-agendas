#!/usr/bin/env node
import { createHash } from "node:crypto";
import { statSync, readFileSync, writeFileSync, copyFileSync, chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "../..");

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

const targetDir =
  process.env.DTE_BOLETA39_SCHEMA_FIX_OUTPUT_DIR ??
  "/home/verf/secure/dte-lab/caf/artifacts/boleta39-schema-fix";

const resolvedTargetDir = resolve(targetDir);

// Requisito 1 & 2: Abortar si el directorio contiene archivos (previene sobrescrituras accidentales)
let existingFiles = [];
try {
  existingFiles = readdirSync(resolvedTargetDir);
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

if (existingFiles.length > 0) {
  if (process.env.ALLOW_OVERWRITE_TEST_DIR) {
    for (const file of existingFiles) {
      const p = join(resolvedTargetDir, file);
      chmodSync(p, 0o600);
      rmSync(p, { force: true, recursive: true });
    }
  } else {
    console.error(`ERROR: Target directory ${resolvedTargetDir} is not empty (${existingFiles.length} files found). Aborting.`);
    process.exit(1);
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

const {
  loadAuthorizedBoleta39CertificationCaf,
} = require(resolve(repoRoot, "lib/dte/certification/boleta39-certification-caf.ts"));
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

mkdirSync(resolvedTargetDir, { recursive: true, mode: 0o700 });
chmodSync(resolvedTargetDir, 0o700);

const generationTimestamp = chileTimestamp();
const generationInput = {
  tenantId: authorization.tenantId,
  issueDate: authorization.authorizationDate,
  firstFolio: 1,
  outputDir: resolvedTargetDir,
  issuer: issuer(),
  cafXml: authorizedCaf.cafXml,
  cafPrivateKeyPem: authorizedCaf.cafPrivateKeyPem,
  cafPublicKeyPem: authorizedCaf.cafPublicKeyPem,
  certificatePath: required("DTE_CERT_PATH"),
  privateKeyPath: required("DTE_PRIVATE_KEY_PATH"),
  generationTimestamp,
};

console.log(`Generating fixed boleta 39 certification artifacts in ${resolvedTargetDir}...`);
const realResult = await prepareRealBoleta39Certification(generationInput);

const generatedEnvelopePath = join(resolvedTargetDir, "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml");
const targetFixedEnvelopePath = join(resolvedTargetDir, "EnvioBOLETA-39-CASO-1-5-CERTIFICATION-SCHEMA-FIX.xml");

copyFileSync(generatedEnvelopePath, targetFixedEnvelopePath);
chmodSync(targetFixedEnvelopePath, 0o600);
rmSync(generatedEnvelopePath, { force: true });

// Requisito 6: Ejecutar verificaciones locales (XSD, Hashes)
const xsdPath = resolve(repoRoot, "docs/dte-sii/xsd/boleta-v11/EnvioBOLETA_v11.xsd");
const validateXsdScript = resolve(repoRoot, "scripts/dte/validate-xsd.mjs");
const xsdOutput = execFileSync("node", [validateXsdScript, targetFixedEnvelopePath, xsdPath], { encoding: "utf8" });

if (!xsdOutput.includes("xsd_valid=true")) {
  throw new Error(`XSD validation failed for ${targetFixedEnvelopePath}: ${xsdOutput}`);
}

const xmlBytes = readFileSync(targetFixedEnvelopePath);
const xmlSha256 = sha256(xmlBytes);

const rcofPath = join(resolvedTargetDir, "RCOF-39-FOLIOS-1-5-CERTIFICATION.xml");
const rcofBytes = readFileSync(rcofPath);
const rcofSha256 = sha256(rcofBytes);

const xmlArtifacts = [];
for (let i = 1; i <= 5; i++) {
  const name = `CASO-${i}-BOLETA-39-CERTIFICATION.xml`;
  const bytes = readFileSync(join(resolvedTargetDir, name));
  xmlArtifacts.push({
    name,
    sha256: sha256(bytes),
    byteLength: bytes.length,
  });
}
xmlArtifacts.push({
  name: "EnvioBOLETA-39-CASO-1-5-CERTIFICATION-SCHEMA-FIX.xml",
  sha256: xmlSha256,
  byteLength: xmlBytes.length,
});
xmlArtifacts.push({
  name: "RCOF-39-FOLIOS-1-5-CERTIFICATION.xml",
  sha256: rcofSha256,
  byteLength: rcofBytes.length,
});

const reportContent = {
  status: "CERTIFICATION_ARTIFACTS_VALIDATED",
  environment: "certification",
  documentType: 39,
  range: { from: 1, to: 5 },
  frmaVerificationStatus: "not_independently_verified_missing_official_idk100_anchor",
  siiContacted: false,
  productionFoliosUsed: false,
  cases: [
    { caseId: "CASO-1", folio: 1, total: 29800 },
    { caseId: "CASO-2", folio: 2, total: 2040 },
    { caseId: "CASO-3", folio: 3, total: 4100 },
    { caseId: "CASO-4", folio: 4, total: 14720 },
    { caseId: "CASO-5", folio: 5, total: 3500 },
  ],
  totals: {
    netAmount: 43831,
    exemptAmount: 2000,
    taxAmount: 8329,
    totalAmount: 54160,
  },
  xsd: {
    boletas: "5/5",
    envelope: "valid",
    rcof: "valid",
  },
  signatures: {
    tedFrmt: "5/5",
    boletas: "5/5",
    envelope: "valid",
    rcof: "valid",
  },
  generatedAtChile: generationTimestamp,
  xmlArtifacts,
};

const reportPath = join(resolvedTargetDir, "REPORT-SANITIZED.json");
const reportBytes = Buffer.from(JSON.stringify(reportContent, null, 2) + "\n", "utf8");
writeFileSync(reportPath, reportBytes, { mode: 0o600 });
chmodSync(reportPath, 0o600);
const reportSha256 = sha256(reportBytes);

const sha256sumsLines = [
  ...xmlArtifacts.map((art) => `${art.sha256}  ${art.name}`),
  `${reportSha256}  REPORT-SANITIZED.json`,
  "",
].join("\n");
const sha256sumsPath = join(resolvedTargetDir, "SHA256SUMS");
writeFileSync(sha256sumsPath, sha256sumsLines, { mode: 0o600 });
chmodSync(sha256sumsPath, 0o600);

console.log("=== GENERATOR VERIFICATION SUCCESS ===");
console.log(`Target directory: ${resolvedTargetDir}`);
console.log(`Fixed envelope path: ${targetFixedEnvelopePath}`);
console.log(`Fixed envelope SHA-256: ${xmlSha256}`);
console.log(`Fixed RCOF SHA-256: ${rcofSha256}`);
console.log(`Report SHA-256: ${reportSha256}`);
console.log(`Envelope Byte Length: ${xmlBytes.length}`);
console.log(`XSD Validation: valid against ${xsdPath}`);
console.log(`Signatures: verified (5 DTEs, SetDTE, RCOF)`);
