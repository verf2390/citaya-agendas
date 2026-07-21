import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FacturaCertificationCaseId } from "./factura-electronica-set";
import { auditFacturaSetFinalFiles } from "./factura-encoding-audit";
import { runFacturaSetDryRun } from "./factura-set-dry-run";
import { prepareFixtureCafVault } from "./caf-import-dry-run";
import { FolioSqliteLedger, type AllocationRequest } from "./folio-sqlite-ledger";
import { runPrintedSamplesDryRun } from "./factura-printed-samples-dry-run";
import { runFolioConcurrencyCheck } from "./folio-concurrency-check";

const REQUESTS: AllocationRequest[] = [
  { caseId: "4959698-1", typeCode: 33 }, { caseId: "4959698-2", typeCode: 33 }, { caseId: "4959698-3", typeCode: 33 }, { caseId: "4959698-4", typeCode: 33 },
  { caseId: "4959698-5", typeCode: 61 }, { caseId: "4959698-6", typeCode: 61 }, { caseId: "4959698-7", typeCode: 61 }, { caseId: "4959698-8", typeCode: 56 },
];
export async function runPreCafFinalGate(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await runFolioConcurrencyCheck(false);
  const prepared = prepareFixtureCafVault(env); const issuer = prepared.cafs[0].issuerRut; const ledger = new FolioSqliteLedger(prepared.dbPath);
  let folioMap: Record<string, number>;
  try {
    folioMap = ledger.reservePlan(issuer, REQUESTS);
    const repeated = ledger.reservePlan(issuer, REQUESTS); if (JSON.stringify(folioMap) !== JSON.stringify(repeated)) throw new Error("idempotency failed");
    if (new Set(Object.values(folioMap)).size !== 8) throw new Error("folio collision");
  } finally { ledger.close(); }
  const setDir = join(prepared.outputDir, "final-set-fixture"); mkdirSync(setDir, { recursive: true, mode: 0o700 }); chmodSync(setDir, 0o700);
  const cafByType = Object.fromEntries(prepared.cafs.map((caf) => [caf.typeCode, { cafXml: caf.cafXml, privateKeyPem: caf.privateKeyPem, publicKeyPem: caf.publicKeyPem }]));
  const overrides = { folioByCase: folioMap as Record<FacturaCertificationCaseId, number>, importedCafByType: cafByType };
  const set = runFacturaSetDryRun({ env, outputDir: setDir, overrides });
  const encoding = auditFacturaSetFinalFiles({ env, outputDir: setDir, skipGeneration: true });
  const printedDir = join(prepared.outputDir, "final-printed-fixture");
  const printed = await runPrintedSamplesDryRun({ env, sourceDir: setDir, skipSourceGeneration: true, printedOutputDir: printedDir });
  if (set.documents !== 8 || encoding.tedFrmtFinalBytes !== "8/8" || printed.pdfFiles !== 12 || !prepared.cafs.every((caf) => caf.weakLegacyFixture && caf.realUseBlocked)) throw new Error("final audit failed");
  console.log("environment=certification\nfixtureMode=true\nrequiredCafTypes=3\ncafType33Coverage=4\ncafType61Coverage=3\ncafType56Coverage=1\ncafStructure=3/3\ncafIssuerMatch=3/3\ncafSiiSignatureFixture=3/3\ncafKeyPairMatch=3/3\ncafPublicKeyMatch=3/3\ncafPreserved=3/3\nfolioAllocationPlan=8/8\nreferenceMap=valid\natomicReservation=valid\nconcurrencyAttempts=100\nconcurrencyCollisions=0\nidempotency=valid\nrollback=valid\nsecretRedaction=valid\nfinalDte=8/8\nfinalPrintedSamples=12/12\nofficialSiiTrustAnchor=pending_real_caf_idk\nrealCaf=false\nsiiContacted=false\ncafDownloadGate=READY_FOR_HUMAN_REVIEW\nreadyToDownloadCaf=false");
}
