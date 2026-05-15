#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });

  module._compile(output.outputText, filename);
};

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const { checkDteReadiness } = require(resolve(
  repoRoot,
  "lib/dte/readiness/check-dte-readiness.ts",
));

const result = checkDteReadiness({ repoRoot });

console.log("Citaya DTE/SII Pre-Certification Readiness");
console.log("");
console.log(`Laboratorio tecnico: ${result.labScore}/10`);
console.log(`Certificacion SII readiness: ${result.certificationScore}/10`);
console.log(`Produccion tecnica: ${result.productionTechnicalScore}/10`);
console.log("");
console.log(`Estado global: ${result.globalStatus}`);
console.log("");

console.log("Bloqueantes:");
if (result.blockers.length === 0) {
  console.log("- Sin bloqueantes tecnicos locales para continuar pre-certificacion.");
} else {
  for (const blocker of result.blockers) console.log(`- ${blocker}`);
}

console.log("");
console.log("Pendientes importantes:");
if (result.importantPending.length === 0) {
  console.log("- Sin pendientes importantes locales.");
} else {
  for (const pending of result.importantPending.slice(0, 12)) {
    console.log(`- ${pending}`);
  }
}

console.log("");
console.log("Proximos pasos:");
for (const action of result.nextActions) console.log(`- ${action}`);

console.log("");
console.log(
  "Resultado: tecnicamente preparado para iniciar certificacion SII cuando existan secretos reales, acceso SII y envio controlado. No significa aprobado SII.",
);

if (result.hasDangerousConfig) process.exit(2);
if (result.hasCriticalMissing) process.exit(1);
process.exit(0);
