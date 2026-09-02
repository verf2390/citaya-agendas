import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertNoOverlappingOrDuplicateCafs, loadCafAuthorization, type CafTrustStore } from "../certification/caf-secure-import";
import { prepareFixtureCafVault } from "../certification/caf-import-dry-run";
import { FolioSqliteLedger } from "../certification/folio-sqlite-ledger";

function fixtureEnvironment(): { env: NodeJS.ProcessEnv; outputDir: string } {
  const root = mkdtempSync(join(tmpdir(), "pre-caf-12-fixture-"));
  const inputPath = join(root, "input.json");
  const outputDir = join(root, "vault");
  writeFileSync(inputPath, JSON.stringify({ issuer: { rutEmisor: "11111111-1", razonSocial: "EMISOR FIXTURE" } }), { encoding: "utf8", mode: 0o600 });
  chmodSync(inputPath, 0o600);
  return { env: { NODE_ENV: "test", DTE_SII_ENV: "certification", DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath, DTE_CERTIFICATION_ISSUE_DATE: "2026-07-19" }, outputDir };
}
function fixture() {
  const { env, outputDir } = fixtureEnvironment();
  const prepared = prepareFixtureCafVault(env, process.cwd(), outputDir); const caf = prepared.cafs[0]; const anchorPath = join(prepared.outputDir, "fixture-trust-anchor-public.pem");
  const trust: CafTrustStore = new Map([[caf.idk, { idk: caf.idk, mode: "fixture", publicKeyPath: anchorPath, provenance: "generated:test", sha256: createHash("sha256").update(readFileSync(anchorPath)).digest("hex") }]]);
  return { prepared, caf, trust };
}
function copy(bytes: Buffer, transform: (xml: string) => string): string { const dir = mkdtempSync(join(tmpdir(), "pre-caf-12-negative-")); const path = join(dir, "caf.xml"); writeFileSync(path, Buffer.from(transform(bytes.toString("latin1")), "latin1")); chmodSync(path, 0o600); return path; }

test("PRE-CAF 12 preserves exact blocks and rejects duplicate/overlap", () => {
  const { caf } = fixture(); assert.ok(caf.originalBytes.includes(caf.cafBytes)); assert.ok(caf.cafBytes.includes(caf.daBytes)); assert.throws(() => assertNoOverlappingOrDuplicateCafs([caf, caf]), /duplicate/);
  assert.throws(() => assertNoOverlappingOrDuplicateCafs([caf, { ...caf, sha256: "different", logicalIdentity: "different" }]), /overlap/);
});
test("PRE-CAF 12 rejects altered signatures, semantics and keys", () => {
  const { caf, trust } = fixture(); const options = { repoRoot: process.cwd(), expectedIssuerRut: caf.issuerRut, expectedType: caf.typeCode, minimumAvailable: 4, trustStore: trust, fixtureMode: true };
  const mutations = [(x: string) => x.replace(/(<FRMA[^>]*>)(.)/, "$1X"), (x: string) => x.replace(/<RS>[^<]*<\/RS>/, "<RS>ALTERADO</RS>"), (x: string) => x.replace(`<IDK>${caf.idk}</IDK>`, "<IDK>999999</IDK>"), (x: string) => x.replace(`<TD>${caf.typeCode}</TD>`, "<TD>34</TD>"), (x: string) => x.replace(/<H>\d+<\/H>/, "<H>1</H>"), (x: string) => x.replace(/(<M>)(.)/, "$1A")];
  for (const mutate of mutations) assert.throws(() => loadCafAuthorization(copy(caf.originalBytes, mutate), options), /CAF_REJECTED/);
});
test("PRE-CAF 12 rejects XXE, symlink, unsafe permissions and production", () => {
  const { caf, trust } = fixture(); const options = { repoRoot: process.cwd(), expectedIssuerRut: caf.issuerRut, expectedType: caf.typeCode, minimumAvailable: 4, trustStore: trust, fixtureMode: true };
  assert.throws(() => loadCafAuthorization(copy(caf.originalBytes, (x) => x.replace("?>", "?><!DOCTYPE AUTORIZACION [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]>")), options), /DOCTYPE/);
  const target = copy(caf.originalBytes, (x) => x); chmodSync(target, 0o644); assert.throws(() => loadCafAuthorization(target, options), /permissions/);
  const link = join(mkdtempSync(join(tmpdir(), "pre-caf-12-link-")), "caf.xml"); symlinkSync(caf.sourcePath, link); assert.throws(() => loadCafAuthorization(link, options), /path/);
  const production = fixtureEnvironment(); assert.throws(() => prepareFixtureCafVault({ ...production.env, NODE_ENV: "production" }, process.cwd(), production.outputDir), /environment/);
});
test("PRE-CAF 12 ledger is idempotent, rolls back and never releases issued", () => {
  const { prepared, caf } = fixture(); const ledger = new FolioSqliteLedger(prepared.dbPath);
  try {
    const first = ledger.reservePlan(caf.issuerRut, [{ caseId: "fixture-case-a", typeCode: caf.typeCode }]); assert.deepEqual(first, ledger.reservePlan(caf.issuerRut, [{ caseId: "fixture-case-a", typeCode: caf.typeCode }]));
    ledger.markIssued(caf.issuerRut, "fixture-case-a"); assert.throws(() => ledger.releaseReserved(caf.issuerRut, "fixture-case-a"), /state/);
    const before = ledger.db.prepare("SELECT COUNT(*) n FROM folios WHERE state='reserved'").get() as { n: number };
    assert.throws(() => ledger.reservePlan(caf.issuerRut, [{ caseId: "rollback-one", typeCode: caf.typeCode }, { caseId: "rollback-two", typeCode: 99 as 33 } ]));
    const after = ledger.db.prepare("SELECT COUNT(*) n FROM folios WHERE state='reserved'").get() as { n: number }; assert.equal(after.n, before.n);
  } finally { ledger.close(); }
});
