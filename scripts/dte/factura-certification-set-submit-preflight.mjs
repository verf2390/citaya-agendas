import { require } from "./dte-ts-loader.mjs";
const {
  preflightCertificationSetSubmit,
  formatSubmitPreflight,
  formatSubmitError,
} = require("../../lib/dte/certification/factura-certification-set-submit.ts");
try {
  console.log(formatSubmitPreflight(preflightCertificationSetSubmit()));
} catch (error) {
  console.error(formatSubmitError(error));
  process.exitCode = 1;
}
