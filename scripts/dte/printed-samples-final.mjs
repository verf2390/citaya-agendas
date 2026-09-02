import { require } from "./dte-ts-loader.mjs";

const {
  formatFinalPrintedSamplesResult,
  prepareFinalPrintedSamples,
} = require("../../lib/dte/certification/printed-samples-final.ts");

try {
  console.log(
    formatFinalPrintedSamplesResult(await prepareFinalPrintedSamples()),
  );
} catch (error) {
  console.error("samplesGenerated=0");
  console.error(
    error instanceof Error
      ? error.message.replace(/[^A-Za-z0-9_.:-]/g, "_")
      : "FINAL_PRINTED_SAMPLES_REJECTED",
  );
  process.exitCode = 1;
}
