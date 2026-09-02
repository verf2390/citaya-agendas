#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

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

function envValue(name) {
  return String(process.env[name] ?? "").trim();
}

function assertNoProductionRisk() {
  if (envValue("DTE_MODE") === "production") {
    console.error("NO BAJAR CAF");
    console.error("blocked_production: DTE_MODE=production bloqueado para PRE-CAF.");
    process.exit(2);
  }
  if (envValue("DTE_SII_ENV") === "production") {
    console.error("NO BAJAR CAF");
    console.error("blocked_production: DTE_SII_ENV=production bloqueado para PRE-CAF.");
    process.exit(2);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

assertNoProductionRisk();

const { checkBoletaPreCafReadiness } = require(resolve(
  repoRoot,
  "lib/dte/certification/boleta-electronica-set.ts",
));

const outputDir = resolve(
  repoRoot,
  envValue("DTE_BOLETA_CERTIFICATION_DRY_RUN_DIR") || "tmp/dte-certification/boleta-set-dry-run",
);
const setPath = resolve(outputDir, "boletas-tipo-39-set-dry-run.xml");
const rcofPath = resolve(outputDir, "rcof-boletas-tipo-39-dry-run.xml");
const metadataPath = resolve(outputDir, "metadata.json");
const cafPath = envValue("DTE_CAF_PATH") || "/home/verf/secure/dte-lab/caf/caf-certification.xml";
const cafKeyPath = envValue("DTE_CAF_PRIVATE_KEY_PATH") || "/home/verf/secure/dte-lab/private/caf-private-key.pem";
const missing = [
  ["set", setPath],
  ["rcof", rcofPath],
  ["metadata", metadataPath],
].filter(([, path]) => !existsSync(path));

if (missing.length > 0) {
  console.log("Citaya Boleta Electronica PRE-CAF Check");
  console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
  console.log("NO BAJAR CAF");
  for (const [name, path] of missing) {
    console.log(`[FAIL] ${name}: falta ${path}`);
  }
  console.log("sii_contact=no");
  console.log("track_id_simulado=NO");
  console.log("production=false");
  process.exit(1);
}

const setXml = readFileSync(setPath, "latin1");
const rcofXml = readFileSync(rcofPath, "latin1");
const metadata = readJson(metadataPath);
const result = checkBoletaPreCafReadiness({
  setXml,
  rcofXml,
  metadata,
  cafPresent: existsSync(cafPath),
  cafKeyPresent: existsSync(cafKeyPath),
});

metadata.issuerDataReady = result.issuerDataReady;
metadata.preCafReady = result.preCafReady;
metadata.preCafStatus = result.status;
metadata.preCafChecks = result.checks;
metadata.siiContact = false;
metadata.trackIdSimulated = false;
metadata.production = false;
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}
`, "utf8");

console.log("Citaya Boleta Electronica PRE-CAF Check");
console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
console.log(`status=${result.status}`);
console.log(`issuerDataReady=${result.issuerDataReady}`);
console.log(`preCafReady=${result.preCafReady}`);
console.log(`setEnvelope=${setPath}`);
console.log(`rcof=${rcofPath}`);
console.log(`metadata=${metadataPath}`);
for (const item of result.checks) {
  console.log(`[${item.ok ? "OK" : "FAIL"}] ${item.key}: ${item.message}`);
}
console.log("sii_contact=no");
console.log("track_id_simulado=NO");
console.log("submitBlocked=true");
console.log("production=false");
console.log(result.status);

process.exit(result.ok ? 0 : 1);
