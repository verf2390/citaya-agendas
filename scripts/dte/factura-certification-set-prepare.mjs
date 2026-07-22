import { require } from "./dte-ts-loader.mjs";
const {
  prepareFacturaCertificationSet,
  formatCertificationSetPrepare,
} = require("../../lib/dte/certification/factura-certification-set-prepare.ts");
try {
  console.log(formatCertificationSetPrepare(prepareFacturaCertificationSet()));
} catch (error) {
  console.error("status=REJECTED");
  const message = error instanceof Error ? error.message : "unknown";
  console.error(
    `error=${/^(CERTIFICATION_SET_PREPARE_REJECTED|REAL_CAF_BUNDLE_REJECTED|CAF_REJECTED|FOLIO_REJECTED) field=[A-Za-z0-9_.-]+$/.test(message) ? message : "CERTIFICATION_SET_PREPARE_FAILED"}`,
  );
  process.exitCode = 1;
}
