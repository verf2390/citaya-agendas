import { require } from "./dte-ts-loader.mjs";
const { submitReconciledCertificationSetRetry, formatSubmitResult, formatSubmitError } = require("../../lib/dte/certification/factura-certification-set-submit.ts");
try { console.log(formatSubmitResult(await submitReconciledCertificationSetRetry())); } catch (error) { console.error(formatSubmitError(error)); process.exitCode = 1; }
