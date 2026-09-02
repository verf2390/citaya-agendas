import { require } from "./dte-ts-loader.mjs";
const { runFolioConcurrencyCheck } = require("../../lib/dte/certification/folio-concurrency-check.ts");
try { await runFolioConcurrencyCheck(); } catch (error) { console.error("status=failed"); console.error("stage=pre_caf_12_concurrency"); console.error(`error=${error instanceof Error ? error.message : "unknown"}`); process.exitCode = 1; }
