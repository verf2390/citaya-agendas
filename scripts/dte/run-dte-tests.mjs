#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const requestedTestFile = process.env.DTE_TEST_FILE;
const baseTestEnv = {
  DTE_MODE: "certification",
  DTE_SII_ENV: "certification",
  DTE_SII_LIVE_AUTH: "false",
  DTE_SII_ENABLE_SUBMIT: "false",
  DTE_SII_ENABLE_STATUS: "false",
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_test_key_long_enough_for_validation_pass",
};

for (const name of Object.keys(process.env)) {
  if (["DTE_", "SII_", "CAF_", "CERT_"].some((prefix) => name.startsWith(prefix)))
    delete process.env[name];
}
Object.assign(process.env, baseTestEnv);

const require = createRequire(import.meta.url);
const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = resolve(repoRoot, request.slice(2));
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.Node16,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node16,
    },
    fileName: filename,
  });

  module._compile(output.outputText, filename);
};

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const testDir = resolve(repoRoot, "lib/dte/__tests__");

if (requestedTestFile && !/^[a-z0-9-]+\.test\.ts$/.test(requestedTestFile))
  throw new Error("DTE_TEST_FILE must name a DTE test file");
const testFiles = requestedTestFile
  ? [requestedTestFile]
  : readdirSync(testDir).filter((name) => name.endsWith(".test.ts")).sort();
for (const file of testFiles) {
  require(resolve(testDir, file));
}
