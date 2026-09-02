#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const fixtureRoot = "/tmp/citaya-dte-auto-fixtures";

Object.assign(process.env, {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55436",
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjcyMzIwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.LT8oiAB38Zgu24uVYFbqgdLjGycLdr_I2BTT0nHyMbY",
  DTE_PRODUCTION_ENABLED: "true",
  DTE_MODE: "production",
  DTE_SII_ENV: "production",
  DTE_SIGNING_MODE: "production",
  DTE_PRODUCTION_SEED_URL: "https://palena.sii.cl/DTEWS/CrSeed.jws",
  DTE_PRODUCTION_TOKEN_URL: "https://palena.sii.cl/DTEWS/GetTokenFromSeed.jws",
  DTE_PRODUCTION_UPLOAD_URL: "https://palena.sii.cl/cgi_dte/UPL/DTEUpload",
  DTE_PRODUCTION_STATUS_URL: "https://palena.sii.cl/DTEWS/QueryEstUp.jws",
  DTE_PRODUCTION_STORAGE_BUCKET: "dte-production-private",
  DTE_PRODUCTION_CAF_ROOT: `${fixtureRoot}/caf`,
  DTE_PRODUCTION_CERTIFICATE_ROOT: `${fixtureRoot}/certificate`,
  DTE_PRODUCTION_PRIVATE_KEY_ROOT: `${fixtureRoot}/certificate`,
  DTE_PRODUCTION_TRUST_ANCHOR_IDK: "100",
  DTE_PRODUCTION_TRUST_ANCHOR_PATH: `${fixtureRoot}/anchor.pem`,
  DTE_PRODUCTION_TRUST_ANCHOR_PROVENANCE:
    "official:https://www.sii.cl/offline-fixture-only",
  DTE_PRODUCTION_TRUST_ANCHOR_SHA256: "a".repeat(64),
  DTE_PRODUCTION_DATA_KEY: Buffer.alloc(32, 7).toString("base64"),
  DTE_PRODUCTION_TIMEOUT_MS: "30000",
});
delete process.env.DTE_AUTOMATIC_WORKER_ENABLED;

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

require(resolve(repoRoot, "scripts/dte/automatic-pre-network-e2e.ts"));
