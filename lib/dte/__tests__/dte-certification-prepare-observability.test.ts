import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertCertificationOutputPreflight,
  CertificationSetPrepareError,
  formatCertificationSetPrepareError,
  resolveCertificationFolioPlan,
  runCertificationGeneration,
  type CertificationPrepareStage,
} from "../certification/factura-certification-set-prepare";
import { FolioSqliteLedger } from "../certification/folio-sqlite-ledger";

const KEY = "SET-4959698-ATTEMPT-001";
const ISSUER = "fixture-issuer";
const PLAN = [
  [33, 1, "4959698-1"],
  [33, 2, "4959698-2"],
  [33, 3, "4959698-3"],
  [33, 4, "4959698-4"],
  [61, 1, "4959698-5"],
  [61, 2, "4959698-6"],
  [61, 3, "4959698-7"],
  [56, 1, "4959698-8"],
] as const;
function seededLedger(): { ledger: FolioSqliteLedger; path: string } {
  const root = mkdtempSync(join(tmpdir(), "prepare-observe-"));
  const path = join(root, "ledger.sqlite");
  const ledger = new FolioSqliteLedger(path);
  const insertCaf = ledger.db.prepare(
    "INSERT INTO caf_imports(issuer,type_code,range_from,range_to,content_sha256,logical_identity,imported_at) VALUES(?,?,?,?,?,?,?)",
  );
  const insertFolio = ledger.db.prepare(
    "INSERT INTO folios(issuer,type_code,folio,caf_id,state,reserved_case) VALUES(?,?,?,?,?,?)",
  );
  for (const [type, to] of [
    [33, 5],
    [61, 4],
    [56, 2],
  ] as const) {
    const result = insertCaf.run(
      ISSUER,
      type,
      1,
      to,
      `${type}`.padStart(64, "0"),
      `logical-${type}`,
      "2026-01-01T00:00:00.000Z",
    );
    for (let folio = 1; folio <= to; folio += 1) {
      const item = PLAN.find(([t, f]) => t === type && f === folio);
      insertFolio.run(
        ISSUER,
        type,
        folio,
        Number(result.lastInsertRowid),
        item ? "reserved" : "available",
        item ? `${KEY}:${item[2]}` : null,
      );
    }
  }
  return { ledger, path };
}
function stateCounts(ledger: FolioSqliteLedger): {
  reserved: number;
  issued: number;
  audit: number;
} {
  return ledger.db
    .prepare(
      "SELECT SUM(state='reserved') reserved,SUM(state='issued') issued,(SELECT COUNT(*) FROM folio_audit) audit FROM folios",
    )
    .get() as { reserved: number; issued: number; audit: number };
}

test("resume accepts an empty owned mode-700 output and rejects partial output", () => {
  const root = mkdtempSync(join(tmpdir(), "prepare-output-"));
  const output = join(root, "attempt-001");
  mkdirSync(output, { mode: 0o700 });
  chmodSync(output, 0o700);
  assert.doesNotThrow(() => assertCertificationOutputPreflight(output));
  writeFileSync(join(output, "partial.xml"), "fixture", { mode: 0o600 });
  assert.throws(
    () => assertCertificationOutputPreflight(output),
    (error) =>
      error instanceof CertificationSetPrepareError &&
      error.stage === "output_preflight" &&
      error.field === "output.not_empty",
  );
});

test("resume reuses the complete plan without new reservations", () => {
  const { ledger } = seededLedger();
  try {
    const before = stateCounts(ledger);
    const result = resolveCertificationFolioPlan(ledger, ISSUER, KEY);
    const after = stateCounts(ledger);
    assert.equal(result.reused, true);
    assert.deepEqual(
      Object.values(result.folioByCase),
      [1, 2, 3, 4, 1, 2, 3, 1],
    );
    assert.deepEqual(after, before);
  } finally {
    ledger.close();
  }
});

for (const stage of [
  "manifest_build",
  "document_build",
  "dte_signature",
  "xsd_validation",
  "output_write",
] as const satisfies readonly CertificationPrepareStage[]) {
  test(`failure at ${stage} never finalizes folios`, () => {
    let finalized = 0;
    assert.throws(
      () =>
        runCertificationGeneration(
          (onStage) => {
            onStage(stage);
            throw new Error("secret /secure/path 76086428-5 <XML> PRIVATE KEY");
          },
          () => {
            finalized += 1;
          },
        ),
      (error) =>
        error instanceof CertificationSetPrepareError &&
        error.stage === stage &&
        error.internalCause instanceof Error,
    );
    assert.equal(finalized, 0);
  });
}

test("atomic ledger finalization rolls back every transition on failure", () => {
  const { ledger } = seededLedger();
  try {
    const cases = PLAN.map(([, , caseId]) => `${KEY}:${caseId}`);
    assert.throws(() =>
      ledger.markPlanIssued(ISSUER, [...cases.slice(0, 7), `${KEY}:missing`]),
    );
    assert.deepEqual(stateCounts(ledger), { reserved: 8, issued: 0, audit: 0 });
  } finally {
    ledger.close();
  }
});

test("public error output is structured and never exposes internal cause", () => {
  const secrets = [
    "76086428-5",
    "/home/secure/private.pem",
    "PRIVATE KEY",
    "<AUTORIZACION>",
    "RSASK",
    "token-secret",
  ];
  const error = new CertificationSetPrepareError(
    "ted_frmt",
    "generation",
    new Error(secrets.join(" ")),
  );
  const output = formatCertificationSetPrepareError(error);
  assert.equal(
    output,
    "code=CERTIFICATION_SET_PREPARE_REJECTED\nstage=ted_frmt\nfield=generation\nmessage=controlled_operation_failed",
  );
  for (const secret of secrets) assert.equal(output.includes(secret), false);
});
