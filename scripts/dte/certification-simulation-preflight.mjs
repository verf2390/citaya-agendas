import { require } from "./dte-ts-loader.mjs";
const { preflightCertificationSetSubmit, formatSubmitPreflight, formatSubmitError } = require("../../lib/dte/certification/factura-certification-set-submit.ts");
try {
  const result = preflightCertificationSetSubmit();
  if (result.artifactKind !== "certification_simulation_set") throw new Error("simulation_artifact_required");
  console.log(formatSubmitPreflight(result));
} catch (error) {
  console.error(formatSubmitError(error));
  process.exitCode = 1;
}
