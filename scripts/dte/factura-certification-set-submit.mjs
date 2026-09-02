import { require } from "./dte-ts-loader.mjs";
const {
  submitPreparedCertificationSet,
  formatSubmitResult,
  formatSubmitError,
} = require("../../lib/dte/certification/factura-certification-set-submit.ts");
try {
  console.log(formatSubmitResult(await submitPreparedCertificationSet()));
} catch (error) {
  console.error(formatSubmitError(error));
  process.exitCode = 1;
}
