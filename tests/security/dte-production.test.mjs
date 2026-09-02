import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(".");

test("DTE production routes require tenant admin and never return secure paths", () => {
  const files = [
    "app/api/admin/dte-production/drafts/route.ts",
    "app/api/admin/dte-production/caf/import/route.ts",
    "app/api/admin/dte-production/[id]/prepare/route.ts",
    "app/api/admin/dte-production/[id]/preflight/route.ts",
    "app/api/admin/dte-production/[id]/emit/route.ts",
    "app/api/admin/dte-production/[id]/status/route.ts",
    "app/api/admin/dte-production/[id]/route.ts",
    "app/api/admin/dte-production/[id]/artifacts/[kind]/route.ts",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.match(source, /requireProductionAdmin/);
    assert.doesNotMatch(
      source,
      /certificatePath|privateKeyPath|cafRoot|storageKey|trackId\s*:/,
    );
  }
});

test("DTE production remains fail-closed and private storage forbids public URLs", () => {
  const env = readFileSync(resolve(root, ".env.example"), "utf8");
  const config = readFileSync(
    resolve(root, "lib/dte/production/config.ts"),
    "utf8",
  );
  const migration = readFileSync(
    resolve(root, "migrations/202607240001_dte_production_cutover.sql"),
    "utf8",
  );
  assert.match(env, /^DTE_PRODUCTION_ENABLED=false$/m);
  assert.match(config, /DTE_PRODUCTION_ENABLED/);
  assert.match(config, /host !== "maullin\.sii\.cl"/);
  assert.match(migration, /storage_key !~\* '\^https\?:\/\//);
  assert.match(migration, /attempt_number = 1/);
  assert.match(migration, /status in \('persisted','uploading','submitted','rejected','ambiguous'\)/);
  assert.match(migration, /append-only/);
});

test("DTE production stores no CAF XML, RSASK, certificate or private key columns", () => {
  const migration = readFileSync(
    resolve(root, "migrations/202607240001_dte_production_cutover.sql"),
    "utf8",
  );
  const ddl = migration
    .replace(/--[^\n]*/g, "")
    .replace(/comment on[\s\S]*?;/gi, "");
  assert.doesNotMatch(
    ddl,
    /\b(caf_xml|rsask|rsapk|private_key|certificate_pem)\b/i,
  );
  assert.match(ddl, /certificate_secret_ref/);
});

test("production preparation receives the current document and fails closed on owned-folio conflicts", () => {
  const server = readFileSync(
    resolve(root, "lib/dte/production/server.ts"),
    "utf8",
  );
  const service = readFileSync(
    resolve(root, "lib/dte/production/service.ts"),
    "utf8",
  );
  assert.match(
    service,
    /this\.preparationPreflight\(\{[\s\S]*document: preparationDocument/,
  );
  assert.match(server, /relations\.length !== 1/);
  assert.match(server, /DTE_OWNED_FOLIO_PREFLIGHT_FAILED/);
  assert.match(server, /relation\.document_id === document\.id/);
  assert.match(server, /relation\.business_operation_id === businessOperationId/);
  assert.match(server, /relation\.state === "reserved"/);
  assert.match(server, /document\.folio === null \|\| document\.folio === Number\(relation\.folio\)/);
  assert.match(server, /document\.cafId === null \|\| document\.cafId === relation\.caf_id/);
  assert.match(server, /document\.status === "draft"/);
  assert.match(server, /document\.folio === null/);
  assert.match(server, /document\.cafId === null/);
  assert.match(server, /relations\.length === 0/);
  assert.ok(
    server.indexOf("reusableOwnedPreparationFolio") <
      server.indexOf('.eq("state", "available")'),
  );
  const preflightAt = service.indexOf("await this.preparationPreflight");
  const readyReturnAt = service.indexOf(
    'if (current.status === "ready") return safeDocument(current)',
  );
  const reservationAt = service.indexOf('failureStage = "folio_reservation"');
  assert.ok(preflightAt >= 0 && readyReturnAt > preflightAt);
  assert.ok(reservationAt > readyReturnAt);
});
