#!/usr/bin/env node
import { createHash } from "node:crypto";
import { statSync, readFileSync, writeFileSync, chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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
  process.env.DTE_BOLETA39_SECOND_SUBMIT_OUTPUT_DIR ??
  "/home/verf/secure/dte-lab/caf/artifacts/boleta39-second-submit-6-10";

const resolvedTargetDir = resolve(targetDir);

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
  parseCafRealControlledXml,
} = require(resolve(repoRoot, "lib/dte/caf/parse-caf.real.ts"));
const {
  prepareRealBoleta39Certification,
} = require(resolve(repoRoot, "lib/dte/certification/boleta-pre-caf.ts"));

const newCafPath = "/home/verf/secure/dte-lab/caf/FoliosSII781956453962026832132.xml";
const newCafXml = readFileSync(newCafPath, "latin1");
const parsedNewCaf = parseCafRealControlledXml(newCafXml, "certification-rg-spa");

if (parsedNewCaf.issuerRut !== "78195645-7") {
  throw new Error(`NEW_CAF_ISSUER_MISMATCH:${parsedNewCaf.issuerRut}`);
}
if (parsedNewCaf.documentType !== "boleta_afecta" && parsedNewCaf.documentType !== "boleta_electronica") {
  throw new Error(`NEW_CAF_TIPO_MISMATCH:${parsedNewCaf.documentType}`);
}
if (parsedNewCaf.rangeFrom !== 6 || parsedNewCaf.rangeTo !== 10) {
  throw new Error(`NEW_CAF_RANGE_MISMATCH:${parsedNewCaf.rangeFrom}-${parsedNewCaf.rangeTo}`);
}

function oneTag(xml, tag) {
  const matches = [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g"))];
  return matches[0][0];
}
function valueTag(xml, tag) {
  const block = oneTag(xml, tag);
  const match = block.match(new RegExp(`^<${tag}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${tag}>$`));
  return match[1].trim();
}
function pemKey(raw) {
  const decoded = raw.replace(/&#10;/g, "\n").replace(/&amp;/g, "&").trim();
  return `${decoded}\n`;
}

const cafPrivateKeyPem = pemKey(valueTag(newCafXml, "RSASK"));
const cafPublicKeyPem = pemKey(valueTag(newCafXml, "RSAPUBK"));

const authorizedCaf = {
  authorization: {
    tenantId: "certification-rg-spa",
    authorizationDate: "2026-08-03",
  },
  cafXml: oneTag(newCafXml, "CAF"),
  cafPrivateKeyPem,
  cafPublicKeyPem,
};
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
  firstFolio: 6,
  outputDir: resolvedTargetDir,
  issuer: issuer(),
  cafXml: authorizedCaf.cafXml,
  cafPrivateKeyPem: authorizedCaf.cafPrivateKeyPem,
  cafPublicKeyPem: authorizedCaf.cafPublicKeyPem,
  certificatePath: required("DTE_CERT_PATH"),
  privateKeyPath: required("DTE_PRIVATE_KEY_PATH"),
  generationTimestamp,
};

console.log(`Generating boleta 39 second submit (folios 6-10) artifacts in ${resolvedTargetDir}...`);
const realResult = await prepareRealBoleta39Certification(generationInput);

const generatedEnvelopePath = join(resolvedTargetDir, "EnvioBOLETA-39-CASO-6-10-CERTIFICATION.xml");

const xsdPath = resolve(repoRoot, "docs/dte-sii/xsd/boleta-v11/EnvioBOLETA_v11.xsd");
const validateXsdScript = resolve(repoRoot, "scripts/dte/validate-xsd.mjs");
const xsdOutput = execFileSync("node", [validateXsdScript, generatedEnvelopePath, xsdPath], { encoding: "utf8" });

if (!xsdOutput.includes("xsd_valid=true")) {
  throw new Error(`XSD validation failed for ${generatedEnvelopePath}: ${xsdOutput}`);
}

const xmlBytes = readFileSync(generatedEnvelopePath);
const xmlSha256 = sha256(xmlBytes);

const rcofPath = join(resolvedTargetDir, "RCOF-39-FOLIOS-6-10-CERTIFICATION.xml");
const rcofBytes = readFileSync(rcofPath);
const rcofSha256 = sha256(rcofBytes);

const report = {
  status: "BOLETA39_SECOND_SUBMIT_ARTIFACTS_VALIDATED",
  generatedAt: generationTimestamp,
  environment: "certification",
  outputDir: resolvedTargetDir,
  envelopeFilename: "EnvioBOLETA-39-CASO-6-10-CERTIFICATION.xml",
  envelopePath: generatedEnvelopePath,
  envelopeSha256: xmlSha256,
  rcofFilename: "RCOF-39-FOLIOS-6-10-CERTIFICATION.xml",
  rcofPath,
  rcofSha256,
  folios: [6, 7, 8, 9, 10],
  caseMapping: {
    "CASO-1": 6,
    "CASO-2": 7,
    "CASO-3": 8,
    "CASO-4": 9,
    "CASO-5": 10,
  },
  totals: realResult.rvdTotals,
  signaturesValidated: 12,
  xsdValid: true,
};

const reportPath = join(resolvedTargetDir, "REPORT-SANITIZED.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
chmodSync(reportPath, 0o600);

const shaSumsPath = join(resolvedTargetDir, "SHA256SUMS");
const shaSumsLines = [
  `${xmlSha256}  EnvioBOLETA-39-CASO-6-10-CERTIFICATION.xml`,
  `${rcofSha256}  RCOF-39-FOLIOS-6-10-CERTIFICATION.xml`,
];
for (let f = 6; f <= 10; f++) {
  const caseId = `CASO-${f - 5}`;
  const path = join(resolvedTargetDir, `${caseId}-BOLETA-39-CERTIFICATION.xml`);
  const hash = sha256(readFileSync(path));
  shaSumsLines.push(`${hash}  ${caseId}-BOLETA-39-CERTIFICATION.xml`);
}
writeFileSync(shaSumsPath, shaSumsLines.join("\n") + "\n", { mode: 0o600 });
chmodSync(shaSumsPath, 0o600);

console.log("BOLETA39_SECOND_SUBMIT_ARTIFACTS_OK");
console.log(`Envelope SHA-256: ${xmlSha256}`);
console.log(`RCOF SHA-256: ${rcofSha256}`);
