import { require } from "./dte-ts-loader.mjs";

const {
  prepareFacturaCertificationSetCorrection,
  formatCorrectionPrepare,
  formatCorrectionPrepareDiagnostic,
} = require("../../lib/dte/certification/factura-certification-set-correction-prepare.ts");

try {
  console.log(formatCorrectionPrepare(prepareFacturaCertificationSetCorrection()));
} catch (error) {
  console.error(formatCorrectionPrepareDiagnostic(error));
  process.exitCode = 1;
}
