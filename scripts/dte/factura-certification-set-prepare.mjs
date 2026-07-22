import { require } from "./dte-ts-loader.mjs";
const {
  prepareFacturaCertificationSet,
  formatCertificationSetPrepare,
  formatCertificationSetPrepareError,
} = require("../../lib/dte/certification/factura-certification-set-prepare.ts");
try {
  console.log(formatCertificationSetPrepare(prepareFacturaCertificationSet()));
} catch (error) {
  console.error("status=REJECTED");
  console.error(formatCertificationSetPrepareError(error));
  process.exitCode = 1;
}
