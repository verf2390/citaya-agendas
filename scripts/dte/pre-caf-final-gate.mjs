import { require } from "./dte-ts-loader.mjs";
const { runPreCafFinalGate } = require("../../lib/dte/certification/pre-caf-final-gate.ts");
try { await runPreCafFinalGate(); } catch (error) { console.error("status=failed"); console.error("stage=pre_caf_12_final_gate"); console.error(`error=${error instanceof Error ? error.message : "unknown"}`); process.exitCode = 1; }
