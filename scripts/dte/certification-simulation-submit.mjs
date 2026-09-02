import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { require } from "./dte-ts-loader.mjs";
const { submitPreparedCertificationSet, formatSubmitResult, formatSubmitError } = require("../../lib/dte/certification/factura-certification-set-submit.ts");
try {
  const result = await submitPreparedCertificationSet();
  console.log(formatSubmitResult(result));
  if (result.status === "SUBMITTED") {
    const hash = String(process.env.DTE_FACTURA_CERTIFICATION_ENVELOPE_SHA256 || "").toLowerCase();
    const directory = String(process.env.DTE_FACTURA_CERTIFICATION_SUBMIT_REGISTRY_DIR || "");
    const record = JSON.parse(readFileSync(resolve(directory, hash + ".json"), "utf8"));
    if (record.state !== "submitted" || record.envelopeSha256 !== hash || !/^\d{5,30}$/.test(String(record.trackId || ""))) throw new Error("submitted_record_invalid");
    console.log("trackId=" + record.trackId);
  } else console.log("trackId=");
} catch (error) {
  console.error(formatSubmitError(error));
  process.exitCode = 1;
}
