#!/usr/bin/env node
import { readFileSync } from "node:fs";
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
const { buildDteCertificationReadiness } = require(resolve(
  repoRoot,
  "lib/dte/config/validate-dte-config.ts",
));

function labelForStatus(status) {
  if (status === "ready") return "ready";
  if (status === "blocked_production") return "blocked_production";
  if (status === "missing_external_file") return "missing_external_file";
  return "pending_config";
}

const EXTERNAL_FILES = new Set([
  "DTE_CAF_PATH",
  "DTE_CAF_PRIVATE_KEY_PATH",
  "DTE_CERT_PATH",
  "DTE_PRIVATE_KEY_PATH",
]);

const SII_ENDPOINTS = new Set([
  "DTE_SII_SEED_URL",
  "DTE_SII_TOKEN_URL",
  "DTE_SII_SUBMIT_URL",
  "DTE_SII_STATUS_URL",
]);

function allItemsReady(readiness, keys) {
  return readiness.items
    .filter((item) => keys.has(item.key))
    .every((item) => item.status === "OK");
}

const readiness = buildDteCertificationReadiness({
  mode: process.env.DTE_MODE ?? "lab",
  env: process.env,
  repoRoot,
});

console.log("Citaya DTE SII Certification Readiness");
console.log(`globalStatus=${readiness.globalStatus}`);
console.log(`mode=${readiness.mode}`);
console.log(`siiEnv=${readiness.siiEnv}`);
const certificationFilesReady = allItemsReady(readiness, EXTERNAL_FILES);
const siiEndpointsReady = allItemsReady(readiness, SII_ENDPOINTS);
const productionBlocked = readiness.status === "blocked_production";
const labReady = !productionBlocked && readiness.mode !== "production" && readiness.siiEnv !== "production";
const xmlGenerationReady = labReady && certificationFilesReady;
const submitReady = xmlGenerationReady && siiEndpointsReady && process.env.DTE_SII_ENABLE_SUBMIT === "true";
const effectiveStatus = readiness.status === "ready" && !submitReady
  ? "lab_ready_pending_certification"
  : labelForStatus(readiness.status);

console.log(`status=${effectiveStatus}`);
console.log(`labReady=${labReady}`);
console.log(`certificationFilesReady=${certificationFilesReady}`);
console.log(`xmlGenerationReady=${xmlGenerationReady}`);
console.log(`siiEndpointsReady=${siiEndpointsReady}`);
console.log(`submitReady=${submitReady}`);
console.log(`submitEnabled=${process.env.DTE_SII_ENABLE_SUBMIT === "true"}`);
console.log("");

for (const item of readiness.items) {
  console.log(`[${item.status}] ${item.key}: ${item.message}`);
}

console.log("");
console.log(
  `summary ready=${readiness.summary.ready} pending_config=${readiness.summary.pendingConfig} missing_external_file=${readiness.summary.missingExternalFile} blocked_production=${readiness.summary.blockedProduction}`,
);
console.log("track_id=pendiente_real_no_simulado");
console.log("noProduction=true");

if (readiness.status === "blocked_production") process.exit(2);
if (readiness.mode === "certification" && readiness.status !== "ready") process.exit(1);
process.exit(0);
