import { chmodSync } from "node:fs";
import Database from "better-sqlite3";
import type { ImportedCaf } from "./caf-secure-import";

export type FolioState = "available" | "reserved" | "issued" | "void";
export type AllocationRequest = { caseId: string; typeCode: number };
export type FolioMap = Record<string, number>;

export class FolioSqliteLedger {
  readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path, { timeout: 30_000 });
    chmodSync(path, 0o600);
    this.db.pragma("journal_mode = WAL"); this.db.pragma("synchronous = FULL"); this.db.pragma("foreign_keys = ON"); this.db.pragma("busy_timeout = 30000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS caf_imports (
        id INTEGER PRIMARY KEY, issuer TEXT NOT NULL, type_code INTEGER NOT NULL, range_from INTEGER NOT NULL, range_to INTEGER NOT NULL,
        content_sha256 TEXT NOT NULL UNIQUE, logical_identity TEXT NOT NULL UNIQUE, imported_at TEXT NOT NULL,
        UNIQUE(issuer,type_code,range_from,range_to), CHECK(range_from > 0 AND range_to >= range_from)
      );
      CREATE TABLE IF NOT EXISTS folios (
        issuer TEXT NOT NULL, type_code INTEGER NOT NULL, folio INTEGER NOT NULL, caf_id INTEGER NOT NULL REFERENCES caf_imports(id),
        state TEXT NOT NULL CHECK(state IN ('available','reserved','issued','void')), reserved_case TEXT, reserved_at TEXT, lease_expires_at TEXT,
        issued_at TEXT, PRIMARY KEY(issuer,type_code,folio), UNIQUE(issuer,reserved_case)
      );
      CREATE TABLE IF NOT EXISTS folio_audit (
        id INTEGER PRIMARY KEY, issuer TEXT NOT NULL, type_code INTEGER NOT NULL, folio INTEGER NOT NULL, action TEXT NOT NULL,
        case_id TEXT, happened_at TEXT NOT NULL
      );
    `);
  }
  close(): void { this.db.close(); }
  importCaf(caf: ImportedCaf, now = new Date().toISOString()): void {
    this.db.transaction(() => {
      const duplicate = this.db.prepare("SELECT id FROM caf_imports WHERE content_sha256=? OR logical_identity=?").get(caf.sha256, caf.logicalIdentity) as { id: number } | undefined;
      if (duplicate) return;
      const overlap = this.db.prepare("SELECT 1 FROM caf_imports WHERE issuer=? AND type_code=? AND range_from<=? AND range_to>=?").get(caf.issuerRut, caf.typeCode, caf.rangeTo, caf.rangeFrom);
      if (overlap) throw new Error("CAF_REJECTED field=RNG.overlap");
      const result = this.db.prepare("INSERT INTO caf_imports(issuer,type_code,range_from,range_to,content_sha256,logical_identity,imported_at) VALUES(?,?,?,?,?,?,?)").run(caf.issuerRut, caf.typeCode, caf.rangeFrom, caf.rangeTo, caf.sha256, caf.logicalIdentity, now);
      const insert = this.db.prepare("INSERT INTO folios(issuer,type_code,folio,caf_id,state) VALUES(?,?,?,?, 'available')");
      for (let folio = caf.rangeFrom; folio <= caf.rangeTo; folio += 1) insert.run(caf.issuerRut, caf.typeCode, folio, Number(result.lastInsertRowid));
    }).immediate();
  }
  reservePlan(issuer: string, requests: readonly AllocationRequest[], now = new Date().toISOString(), leaseSeconds = 3600): FolioMap {
    return this.db.transaction(() => {
      const output: FolioMap = {}; const expires = new Date(new Date(now).valueOf() + leaseSeconds * 1000).toISOString();
      for (const request of requests) {
        const existing = this.db.prepare("SELECT folio,type_code,state FROM folios WHERE issuer=? AND reserved_case=?").get(issuer, request.caseId) as { folio: number; type_code: number; state: FolioState } | undefined;
        if (existing) { if (existing.type_code !== request.typeCode || existing.state === "void") throw new Error("FOLIO_REJECTED field=caseId"); output[request.caseId] = existing.folio; continue; }
        const next = this.db.prepare("SELECT folio FROM folios WHERE issuer=? AND type_code=? AND state='available' ORDER BY folio LIMIT 1").get(issuer, request.typeCode) as { folio: number } | undefined;
        if (!next) throw new Error("FOLIO_REJECTED field=rangeExhausted");
        const update = this.db.prepare("UPDATE folios SET state='reserved',reserved_case=?,reserved_at=?,lease_expires_at=? WHERE issuer=? AND type_code=? AND folio=? AND state='available'").run(request.caseId, now, expires, issuer, request.typeCode, next.folio);
        if (update.changes !== 1) throw new Error("FOLIO_REJECTED field=collision");
        this.db.prepare("INSERT INTO folio_audit(issuer,type_code,folio,action,case_id,happened_at) VALUES(?,?,?,?,?,?)").run(issuer, request.typeCode, next.folio, "reserved", request.caseId, now);
        output[request.caseId] = next.folio;
      }
      return output;
    }).immediate();
  }
  markIssued(issuer: string, caseId: string, now = new Date().toISOString()): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT type_code,folio FROM folios WHERE issuer=? AND reserved_case=? AND state='reserved'").get(issuer, caseId) as { type_code: number; folio: number } | undefined;
      if (!row) throw new Error("FOLIO_REJECTED field=state");
      this.db.prepare("UPDATE folios SET state='issued',issued_at=?,lease_expires_at=NULL WHERE issuer=? AND reserved_case=?").run(now, issuer, caseId);
      this.db.prepare("INSERT INTO folio_audit(issuer,type_code,folio,action,case_id,happened_at) VALUES(?,?,?,?,?,?)").run(issuer, row.type_code, row.folio, "issued", caseId, now);
    }).immediate();
  }
  markPlanIssued(issuer: string, caseIds: readonly string[], now = new Date().toISOString()): void {
    this.db.transaction(() => {
      const select = this.db.prepare("SELECT type_code,folio,state FROM folios WHERE issuer=? AND reserved_case=?");
      const update = this.db.prepare("UPDATE folios SET state='issued',issued_at=?,lease_expires_at=NULL WHERE issuer=? AND reserved_case=? AND state='reserved'");
      const audit = this.db.prepare("INSERT INTO folio_audit(issuer,type_code,folio,action,case_id,happened_at) VALUES(?,?,?,?,?,?)");
      const rows = caseIds.map((caseId) => ({ caseId, row: select.get(issuer, caseId) as { type_code: number; folio: number; state: FolioState } | undefined }));
      if (rows.some(({ row }) => row?.state !== "reserved")) throw new Error("FOLIO_REJECTED field=state");
      for (const { caseId, row } of rows) {
        if (!row || update.run(now, issuer, caseId).changes !== 1) throw new Error("FOLIO_REJECTED field=collision");
        audit.run(issuer, row.type_code, row.folio, "issued", caseId, now);
      }
    }).immediate();
  }
  releaseReserved(issuer: string, caseId: string, now = new Date().toISOString()): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT type_code,folio FROM folios WHERE issuer=? AND reserved_case=? AND state='reserved'").get(issuer, caseId) as { type_code: number; folio: number } | undefined;
      if (!row) throw new Error("FOLIO_REJECTED field=state");
      this.db.prepare("UPDATE folios SET state='available',reserved_case=NULL,reserved_at=NULL,lease_expires_at=NULL WHERE issuer=? AND reserved_case=? AND state='reserved'").run(issuer, caseId);
      this.db.prepare("INSERT INTO folio_audit(issuer,type_code,folio,action,case_id,happened_at) VALUES(?,?,?,?,?,?)").run(issuer, row.type_code, row.folio, "released", caseId, now);
    }).immediate();
  }
  recoverExpired(issuer: string, now: string): number {
    return this.db.transaction(() => {
      const rows = this.db.prepare("SELECT type_code,folio,reserved_case FROM folios WHERE issuer=? AND state='reserved' AND lease_expires_at<?").all(issuer, now) as { type_code: number; folio: number; reserved_case: string }[];
      for (const row of rows) {
        this.db.prepare("UPDATE folios SET state='available',reserved_case=NULL,reserved_at=NULL,lease_expires_at=NULL WHERE issuer=? AND type_code=? AND folio=? AND state='reserved'").run(issuer, row.type_code, row.folio);
        this.db.prepare("INSERT INTO folio_audit(issuer,type_code,folio,action,case_id,happened_at) VALUES(?,?,?,?,?,?)").run(issuer, row.type_code, row.folio, "recovered_expired", row.reserved_case, now);
      }
      return rows.length;
    }).immediate();
  }
  counts(): { total: number; distinct: number; reserved: number } {
    return this.db.prepare("SELECT COUNT(*) total,COUNT(DISTINCT issuer||':'||type_code||':'||folio) distinct, SUM(state='reserved') reserved FROM folios").get() as { total: number; distinct: number; reserved: number };
  }
}
