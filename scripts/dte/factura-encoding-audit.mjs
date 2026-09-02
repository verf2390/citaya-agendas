import { require } from "./dte-ts-loader.mjs";

const { auditFacturaSetFinalFiles, formatFacturaEncodingAuditResult } = require("../../lib/dte/certification/factura-encoding-audit.ts");

try {
  const result = auditFacturaSetFinalFiles();
  console.log(formatFacturaEncodingAuditResult(result));
} catch (error) {
  console.error("status=failed");
  console.error("stage=pre_caf_9_encoding_audit");
  console.error(`error=${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
}
