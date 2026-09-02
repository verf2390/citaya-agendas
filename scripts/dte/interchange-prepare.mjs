import { require } from "./dte-ts-loader.mjs";

const {
  formatInterchangePrepareResult,
  prepareInterchange,
} = require("../../lib/dte/interchange/interchange-prepare.ts");

try {
  console.log(formatInterchangePrepareResult(prepareInterchange()));
} catch (error) {
  console.error("interchangePrepared=false");
  console.error(
    error instanceof Error
      ? error.message.replace(/[^A-Za-z0-9_.:-]/g, "_")
      : "INTERCHANGE_PREPARE_REJECTED",
  );
  process.exitCode = 1;
}
