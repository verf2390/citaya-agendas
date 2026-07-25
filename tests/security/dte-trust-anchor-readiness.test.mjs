import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../migrations/202607240004_dte_trust_anchor_gate_separation.sql",
    import.meta.url,
  ),
  "utf8",
);
const loader = readFileSync(
  new URL("../../lib/dte/certification/caf-secure-import.ts", import.meta.url),
  "utf8",
);
const contract = readFileSync(
  new URL("../../lib/dte/trust-anchor-contract.ts", import.meta.url),
  "utf8",
);

test("declaration gate uses secure acquisition procedure and fail-closed import", () => {
  const declaration = migration.match(
    /\) as ready_for_declaration,/,
  )?.index;
  const issuance = migration.match(
    /\) as ready_for_issuance,/,
  )?.index;
  assert.ok(declaration !== undefined && issuance !== undefined);
  assert.ok(issuance > declaration);
  const declarationSql = migration.slice(0, declaration);
  const issuanceSql = migration.slice(declaration, issuance);
  assert.match(declarationSql, /trust_anchor_acquisition_ready/);
  assert.match(declarationSql, /caf_import_fail_closed/);
  assert.doesNotMatch(
    declarationSql.slice(declarationSql.lastIndexOf("select")),
    /\band trust_anchor_valid\b/,
  );
  assert.match(issuanceSql, /and trust_anchor_valid/);
  assert.match(issuanceSql, /and trust_anchor_sha256 is not null/);
  assert.match(issuanceSql, /and caf_count > 0/);
  assert.match(issuanceSql, /and folio_count > 0/);
});

test("migration preserves disabled pre-declaration production settings", () => {
  assert.match(migration, /set issuance_mode = 'manual'/);
  assert.match(migration, /production_enabled = false/);
  assert.match(migration, /caf_ready = false/);
  assert.match(migration, /folio_ready = false/);
  assert.doesNotMatch(migration, /production_enabled = true/);
});

test("production CAF validation rejects unsafe anchors before persistence", () => {
  assert.match(loader, /reject\("trustAnchor\.IDK"\)/);
  assert.match(loader, /reject\("trustAnchor\.provenance"\)/);
  assert.match(loader, /reject\("trustAnchor\.sha256"\)/);
  assert.match(loader, /reject\("trustAnchor\.permissions"\)/);
  assert.match(loader, /reject\("trustAnchor\.owner"\)/);
  assert.match(loader, /reject\("trustAnchor\.role"\)/);
  assert.match(loader, /reject\("FRMA"\)/);
  assert.match(contract, /url\.protocol === "https:"/);
  assert.match(contract, /hostname\.endsWith\("\.sii\.cl"\)/);
});
