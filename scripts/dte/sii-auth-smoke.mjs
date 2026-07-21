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
const {
  getSiiCertificationConfigFromEnv,
  prepareCertificationAuthFlow,
} = require(resolve(repoRoot, "lib/dte/sii/sii-certification-client.ts"));
const { validateSiiAuthConfig } = require(resolve(repoRoot, "lib/dte/sii/sii-auth.ts"));

function printBlocked(message) {
  console.log("environment=certification");
  console.log("seed=blocked");
  console.log("signedXml=blocked");
  console.log("token=blocked");
  console.log("tokenFingerprint=blocked");
  console.error(message);
}

async function main() {
  const config = getSiiCertificationConfigFromEnv(process.env);
  if (config.environment !== "certification" || process.env.DTE_SII_ENV === "production") {
    throw new Error("DTE_SII_ENV debe permanecer en certification; production bloqueado.");
  }

  if (process.env.DTE_SII_LIVE_AUTH !== "true") {
    printBlocked("DTE_SII_LIVE_AUTH=true requerido para contactar solo seed→token en certification.");
    process.exit(1);
  }

  validateSiiAuthConfig(config);
  const auth = await prepareCertificationAuthFlow(config, { dryRun: false });
  if (!auth.seed || !auth.signedSeed.ok || !auth.token.ok || !auth.token.tokenFingerprint) {
    throw new Error("seed→token certification incompleto.");
  }

  console.log("environment=certification");
  console.log("seed=received");
  console.log("signedXml=generated");
  console.log("token=received");
  console.log(`tokenFingerprint=${auth.token.tokenFingerprint}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replace(/TOKEN=[^;\s]+/g, "TOKEN=[redacted]"));
  process.exit(1);
});
