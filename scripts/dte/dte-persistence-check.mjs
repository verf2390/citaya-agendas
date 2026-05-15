#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
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
const { getDtePersistenceBackend, getDteRepository } = require(resolve(
  repoRoot,
  "lib/dte/persistence/get-dte-repository.ts",
));

async function main() {
  const migrationPath = resolve(repoRoot, "docs/dte-sii/DTE_SUPABASE_MIGRATION.sql");
  const docsPath = resolve(repoRoot, "docs/dte-sii/DTE_SUPABASE_PERSISTENCE.md");
  const backend = getDtePersistenceBackend();

  console.log("Citaya DTE Persistence Check");
  console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
  console.log(`backend=${backend}`);
  console.log(`migrationDocumented=${existsSync(migrationPath)}`);
  console.log(`docsDocumented=${existsSync(docsPath)}`);

  if (!existsSync(migrationPath) || !existsSync(docsPath)) {
    process.exit(1);
  }

  try {
    const repo = getDteRepository();
    const documents = await repo.listRecentByTenant({
      tenantId: "tenant-smoke-lab",
      limit: 1,
    });
    console.log(`traceListReady=true documents=${documents.length}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`traceListReady=false error=${message}`);
    if (backend === "supabase") process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
