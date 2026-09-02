import { require } from "./dte-ts-loader.mjs";
const { runPrintedSamplesDryRun, formatPrintedSamplesResult } = require("../../lib/dte/certification/factura-printed-samples-dry-run.ts");
try { console.log(formatPrintedSamplesResult(await runPrintedSamplesDryRun())); }
catch (error) { console.error("status=failed"); console.error("stage=pre_caf_11_printed_samples"); console.error(`error=${error instanceof Error ? error.message : "unknown"}`); process.exitCode = 1; }
