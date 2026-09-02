import { require } from "./dte-ts-loader.mjs";
const { runCafImportDryRun } = require("../../lib/dte/certification/caf-import-dry-run.ts");
try { runCafImportDryRun(); } catch (error) { console.error("status=failed"); console.error("stage=pre_caf_12_caf_import"); console.error(`error=${error instanceof Error ? error.message : "unknown"}`); process.exitCode = 1; }
