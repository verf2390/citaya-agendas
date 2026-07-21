import { require } from "./dte-ts-loader.mjs";

const {
  auditRealCertificationCaf,
  printRealCafAudit,
} = require("../../lib/dte/certification/caf-real-audit.ts");

try {
  const result = auditRealCertificationCaf();
  printRealCafAudit(result);
  if (result.status === "BLOCKED_TRUST_ANCHOR") process.exitCode = 2;
} catch (error) {
  console.error("status=REJECTED");
  const message = error instanceof Error ? error.message : "unknown";
  console.error(
    `error=${/^(REAL_CAF_AUDIT_REJECTED|CAF_REJECTED) field=[A-Za-z0-9_.-]+$/.test(message) ? message : "REAL_CAF_AUDIT_FAILED"}`,
  );
  process.exitCode = 1;
}
