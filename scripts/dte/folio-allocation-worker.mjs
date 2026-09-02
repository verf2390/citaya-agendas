import { require } from "./dte-ts-loader.mjs";
const { FolioSqliteLedger } = require("../../lib/dte/certification/folio-sqlite-ledger.ts");
const [dbPath, issuer, type, caseId] = process.argv.slice(2);
try { const ledger = new FolioSqliteLedger(dbPath); try { ledger.reservePlan(issuer, [{ caseId, typeCode: Number(type) }]); } finally { ledger.close(); } process.stdout.write("ok"); }
catch { process.stderr.write("failed"); process.exitCode = 1; }
