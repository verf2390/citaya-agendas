import { require } from "./dte-ts-loader.mjs";
const { runFacturaBooksDryRun, formatFacturaBooksDryRunResult } = require("../../lib/dte/certification/factura-books-dry-run.ts");
try { console.log(formatFacturaBooksDryRunResult(runFacturaBooksDryRun())); }
catch (error) { console.error("status=failed"); console.error("stage=pre_caf_10_books_dry_run"); console.error(`error=${error instanceof Error ? error.message : "unknown"}`); process.exitCode = 1; }
