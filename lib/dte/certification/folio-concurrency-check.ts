import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FolioSqliteLedger } from "./folio-sqlite-ledger";

const OUTPUT = "/home/verf/secure/dte-lab/caf-import-dry-run";
function worker(db: string, issuer: string, caseId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/dte/folio-allocation-worker.mjs", db, issuer, "33", caseId], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("exit", (code) => code === 0 && stdout === "ok" && !stderr ? resolve() : reject(new Error("concurrent worker failed")));
  });
}
export async function runFolioConcurrencyCheck(emit = true): Promise<void> {
  if (process.env.DTE_SII_ENV !== "certification" || process.env.DTE_MODE === "production" || process.env.NODE_ENV === "production") throw new Error("environment rejected");
  mkdirSync(OUTPUT, { recursive: true, mode: 0o700 }); chmodSync(OUTPUT, 0o700); const dbPath = join(OUTPUT, "concurrency-ledger-fixture.sqlite"); rmSync(dbPath, { force: true });
  const issuer = "fixture-issuer-fingerprint"; const ledger = new FolioSqliteLedger(dbPath);
  ledger.db.transaction(() => {
    const caf = ledger.db.prepare("INSERT INTO caf_imports(issuer,type_code,range_from,range_to,content_sha256,logical_identity,imported_at) VALUES(?,?,?,?,?,?,?)").run(issuer, 33, 1, 100, "fixture-concurrency-hash", "fixture-concurrency-logical", new Date().toISOString());
    const insert = ledger.db.prepare("INSERT INTO folios(issuer,type_code,folio,caf_id,state) VALUES(?,?,?,?, 'available')");
    for (let folio = 1; folio <= 100; folio += 1) insert.run(issuer, 33, folio, Number(caf.lastInsertRowid));
  }).immediate(); ledger.close(); chmodSync(dbPath, 0o600);
  await Promise.all(Array.from({ length: 100 }, (_, index) => worker(dbPath, issuer, `attempt-${index + 1}`)));
  const audit = new FolioSqliteLedger(dbPath);
  try {
    const row = audit.db.prepare("SELECT COUNT(*) count, COUNT(DISTINCT folio) distinct_count FROM folios WHERE issuer=? AND state='reserved'").get(issuer) as { count: number; distinct_count: number };
    if (row.count !== 100 || row.distinct_count !== 100) throw new Error("collision detected");
    let exhausted = false; try { audit.reservePlan(issuer, [{ caseId: "attempt-101", typeCode: 33 }]); } catch { exhausted = true; } if (!exhausted) throw new Error("range exhaustion not enforced");
    const first = audit.reservePlan(issuer, [{ caseId: "attempt-1", typeCode: 33 }]); const second = audit.reservePlan(issuer, [{ caseId: "attempt-1", typeCode: 33 }]); if (first["attempt-1"] !== second["attempt-1"]) throw new Error("idempotency failed");
    const before = audit.db.prepare("SELECT COUNT(*) count FROM folios WHERE state='reserved'").get() as { count: number };
    let rolledBack = false; try { audit.reservePlan(issuer, [{ caseId: "rollback-a", typeCode: 33 }, { caseId: "rollback-b", typeCode: 61 }]); } catch { rolledBack = true; }
    const after = audit.db.prepare("SELECT COUNT(*) count FROM folios WHERE state='reserved'").get() as { count: number }; if (!rolledBack || before.count !== after.count) throw new Error("rollback failed");
    audit.db.prepare("UPDATE folios SET lease_expires_at='2020-01-01T00:00:00.000Z' WHERE issuer=? AND reserved_case='attempt-100'").run(issuer);
    if (audit.recoverExpired(issuer, new Date().toISOString()) !== 1) throw new Error("abandoned recovery failed");
  } finally { audit.close(); }
  if (emit) console.log("environment=certification\nfixtureMode=true\natomicReservation=valid\nconcurrencyAttempts=100\nconcurrencyCollisions=0\nidempotency=valid\nrollback=valid\nabandonedReservationPolicy=expired_lease_explicit_recovery\nsiiContacted=false\nreadyToDownloadCaf=false");
}
