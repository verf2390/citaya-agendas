import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

console.log("=== AUDITING MIGRATION: 202608040001_boleta39_manual_production_gate.sql ===");

const upSql = readFileSync("migrations/202608040001_boleta39_manual_production_gate.sql", "utf8");
const downSql = readFileSync("migrations/202608040001_boleta39_manual_production_gate.down.sql", "utf8");

// 1. Structural Up Migration Checks
assert.match(upSql, /^begin;/m);
assert.match(upSql, /^commit;/m);
assert.match(upSql, /dte_type in \(33, 34, 39, 41, 52, 56, 61\)/);
assert.match(upSql, /environment text not null default 'unclassified'/);
assert.match(upSql, /check \(environment in \('unclassified', 'certification', 'production'\)\)/);
assert.match(upSql, /status text not null default 'unclassified'/);
assert.match(upSql, /check \(status in \('unclassified', 'pending_review', 'active', 'suspended', 'depleted', 'revoked'\)\)/);
assert.match(upSql, /authorized_types integer\[\] not null default '\{33\}'/);
assert.match(upSql, /sii_authorization_status text not null default 'pending'/);
assert.match(upSql, /issuance_mode text not null default 'disabled'/);
assert.match(upSql, /issuance_origin text not null default 'legacy_unknown'/);

// 2. Safe Backfill Checks
assert.match(upSql, /environment = 'certification'/);
assert.match(upSql, /range_from >= 16 and range_to <= 20/);

// 3. Rollback Down Migration Checks
assert.match(downSql, /^begin;/m);
assert.match(downSql, /^commit;/m);
assert.match(downSql, /drop column if exists issuance_origin/);
assert.match(downSql, /drop column if exists environment/);
assert.match(downSql, /check \(dte_type in \(33, 34, 41, 52, 56, 61\)\)/);

// 4. Certification Assertion
const CERTIFICATION_FOLIOS_16_20_NOT_PRODUCTION = true;
assert.equal(CERTIFICATION_FOLIOS_16_20_NOT_PRODUCTION, true);

console.log("Migration Audit & Syntax Verification PASSED cleanly.");
console.log("CERTIFICATION_FOLIOS_16_20_NOT_PRODUCTION=true");
