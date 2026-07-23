import { require } from "./dte-ts-loader.mjs";
const {
  preflightCertificationSetSubmit,
  formatSubmitPreflight,
} = require("../../lib/dte/certification/factura-certification-set-submit.ts");
const safe = (value, fallback) => {
  const text = String(value ?? "");
  return /^[a-z0-9_.-]+$/i.test(text) ? text : fallback;
};
const printRejected = (value) => {
  const record = value && typeof value === "object" ? value : {};
  console.error([
    "status=REJECTED",
    `errorCode=${safe(record.code ?? record.errorCode, "unknown")}`,
    `errorStage=${safe(record.stage ?? record.errorStage, "unknown")}`,
    `errorField=${safe(record.field ?? record.errorField, "unknown")}`,
    "safeMessage=controlled_operation_failed",
  ].join("\n"));
};
try {
  const result = preflightCertificationSetSubmit();
  if (result?.status === "REJECTED") {
    printRejected(result);
    process.exitCode = 1;
  } else {
    console.log(formatSubmitPreflight(result));
  }
} catch (error) {
  printRejected(error);
  process.exitCode = 1;
}
