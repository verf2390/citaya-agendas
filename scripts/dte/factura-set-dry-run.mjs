import { require } from "./dte-ts-loader.mjs";

const { formatFacturaSetDryRunResult, runFacturaSetDryRun } = require("../../lib/dte/certification/factura-set-dry-run.ts");

try {
  const result = runFacturaSetDryRun();
  console.log(formatFacturaSetDryRunResult(result));
} catch (error) {
  console.error(`status=failed`);
  console.error(`stage=pre_caf_8_offline`);
  console.error(`error=${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
}
