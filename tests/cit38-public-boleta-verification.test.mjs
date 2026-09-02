import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("app/api/public/boleta-verification/route.ts", "utf8");
const pdfRoute = readFileSync("app/api/public/boleta-verification/pdf/route.ts", "utf8");
const migration = readFileSync(
  "migrations/202609010001_cit38_canonicalize_production_issuer_rut.sql",
  "utf8",
);

test("CIT-38 uses canonical exact indexed issuer RUT equality", () => {
  assert.match(route, /const issuerRut = normalizeRut\(parsed\.data\.issuerRut\)/);
  assert.match(route, /\.from\("dte_production_tenant_settings"\)[\s\S]*?\.eq\("issuer_rut", issuerRut\)/);
  assert.doesNotMatch(route, /\.ilike\(|\.like\(|issuer_rut[^\n]*(?:ilike|like)/i);
  assert.match(migration, /public\.normalize_chilean_rut\(issuer_rut\)/);
  assert.match(migration, /check \(issuer_rut = public\.normalize_chilean_rut\(issuer_rut\)\)/);
  assert.match(migration, /unique index[\s\S]*\(issuer_rut\)/);
});

test("CIT-38 keeps every public lookup dimension exact and type 39 only", () => {
  for (const predicate of [
    /\.eq\("dte_type", 39\)/,
    /\.eq\("folio", parsed\.data\.folio\)/,
    /\.eq\("issue_date", parsed\.data\.issueDate\)/,
    /\.eq\("total_amount", parsed\.data\.totalAmount\)/,
    /matchesPublicBoletaVerification\(parsed\.data, document\.data\)/,
  ]) {
    assert.match(route, predicate);
  }
});

test("CIT-38 verification is fiscal-state scoped and does not widen tenant capabilities", () => {
  assert.doesNotMatch(route, /loadTenantOperationalContext|publicTaxDocument/);
  assert.doesNotMatch(pdfRoute, /loadTenantOperationalContext|publicTaxDocument/);
  assert.match(route, /sii_status/);
});

test("CIT-38 preserves opaque misses, rate limiting and optional signed PDF grants", () => {
  assert.match(route, /consumeRateLimit\(\{/);
  assert.match(route, /scope: "public_boleta_verification"/);
  assert.match(route, /limit: 8/);
  assert.match(route, /windowSeconds: 15 \* 60/);
  assert.match(route, /found: false/);
  assert.match(route, /artifact\.data[\s\S]*createBoletaPdfGrant[\s\S]*: null/);
  assert.match(pdfRoute, /verifyBoletaPdfGrant/);
  assert.match(pdfRoute, /createServerProductionDteService\(\)\.download/);
  assert.doesNotMatch(route, /storage_key|storage_path|secure_ref/i);
});

test("CIT-38 verification performs no SII call or DTE mutation", () => {
  const verificationSources = `${route}\n${pdfRoute}`;
  assert.doesNotMatch(
    verificationSources,
    /queryStatusManually|uploadExactlyOnce|siiClient|reserve.*folio|emit|reissue/i,
  );
  assert.doesNotMatch(
    verificationSources,
    /\.(?:insert|update|upsert|delete)\s*\(/,
  );
});
