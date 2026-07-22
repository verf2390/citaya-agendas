import { require } from "./dte-ts-loader.mjs";
const { preflightReconciledCertificationSetRetry, formatRetryPreflight, formatSubmitError } = require("../../lib/dte/certification/factura-certification-set-submit.ts");
try { console.log(formatRetryPreflight(preflightReconciledCertificationSetRetry())); } catch (error) { console.error(formatSubmitError(error)); process.exitCode = 1; }
