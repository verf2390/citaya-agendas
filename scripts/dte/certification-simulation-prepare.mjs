import { require } from "./dte-ts-loader.mjs";
const { prepareCertificationSimulationSet, formatCertificationSimulationPrepare } = require("../../lib/dte/certification/certification-simulation-set.ts");
try {
  console.log(formatCertificationSimulationPrepare(prepareCertificationSimulationSet()));
} catch (error) {
  console.error("simulationPrepared=false");
  console.error(error instanceof Error ? error.message.replace(/[^A-Za-z0-9_.=-]/g, "_") : "CERTIFICATION_SIMULATION_REJECTED");
  process.exitCode = 1;
}
