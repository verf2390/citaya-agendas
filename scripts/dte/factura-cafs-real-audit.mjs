import { require } from "./dte-ts-loader.mjs";
const {
  auditRealCertificationCafBundle,
  formatRealCafBundleAudit,
} = require("../../lib/dte/certification/caf-real-bundle-audit.ts");
try {
  console.log(formatRealCafBundleAudit(auditRealCertificationCafBundle()));
} catch (error) {
  console.error("status=REJECTED");
  const message = error instanceof Error ? error.message : "unknown";
  console.error(
    `error=${/^(REAL_CAF_BUNDLE_REJECTED|CAF_REJECTED) field=[A-Za-z0-9_.-]+$/.test(message) ? message : "REAL_CAF_BUNDLE_FAILED"}`,
  );
  process.exitCode = 1;
}
