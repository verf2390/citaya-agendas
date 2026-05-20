import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { checkDteReadiness } from "../readiness/check-dte-readiness";
import { buildAuditRecord } from "./dte-audit";
import { sha256String } from "./dte-hash";
import { safeJsonForAudit } from "./dte-redaction";
import { getDtePersistenceBackend, getDteRepository } from "./get-dte-repository";
import { buildStatusHistoryRecord } from "./dte-status-history";
import { buildSubmissionRecord } from "./dte-submissions";
import type { DtePersistenceTraceSummary } from "./dte-persistence-types";

export type SmokeTraceInput = {
  repoRoot: string;
  outputPath: string;
  dryRun: boolean;
  submitBlocked?: boolean;
  xml?: string | null;
  configSummary: Record<string, unknown>;
  steps: Array<{ name: string; status: string; message: string }>;
};

export function readSmokeTrace(
  outputPath: string,
): DtePersistenceTraceSummary | null {
  if (!existsSync(outputPath)) return null;
  const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as DtePersistenceTraceSummary;
  return parsed;
}

export async function writeSmokeTrace(
  input: SmokeTraceInput,
): Promise<DtePersistenceTraceSummary> {
  const repo = getDteRepository();
  const backend = getDtePersistenceBackend();
  const readiness = checkDteReadiness({ repoRoot: input.repoRoot });
  const xmlSha256 = input.xml ? sha256String(input.xml) : null;

  const draft = await repo.createTaxDocumentDraft({
    tenantId: "tenant-smoke-lab",
    documentType: "factura_afecta",
    folio: 1001,
    emitterRut: "76.123.456-0",
    emitterName: "Empresa Demo Citaya SpA",
    receiverRut: "11.111.111-1",
    receiverName: "Cliente Demo",
    issueDate: new Date().toISOString().slice(0, 10),
    totalAmount: 11900,
    netAmount: 10000,
    taxAmount: 1900,
    exemptAmount: 0,
    paymentReference: "smoke-dry-run",
  });

  if (!draft.ok) {
    throw new Error(draft.error);
  }

  if (input.xml) {
    await repo.markXmlGenerated({
      tenantId: draft.record.tenantId,
      taxDocumentId: draft.record.id,
      xml: input.xml,
      xmlStoragePath: null,
    });
  }

  const submission = buildSubmissionRecord({
    tenantId: draft.record.tenantId,
    taxDocumentId: draft.record.id,
    environment: "certification",
    submissionStatus: input.submitBlocked ? "blocked" : "dry_run",
    siiStatus: "not_sent",
    requestXml: input.xml ?? null,
    response: {
      status: input.submitBlocked ? "blocked" : "dry_run",
      message: "LAB / PENDIENTE / NO PRODUCTIVO",
    },
  });
  await repo.createSiiSubmission(submission);

  await repo.appendStatusHistory(
    buildStatusHistoryRecord({
      tenantId: draft.record.tenantId,
      taxDocumentId: draft.record.id,
      submissionId: submission.id,
      previousStatus: "draft",
      nextStatus: input.xml ? "xml_generated" : "draft",
      previousSiiStatus: "not_sent",
      nextSiiStatus: "not_sent",
      reason: input.submitBlocked
        ? "Submit real bloqueado en smoke certification"
        : "Dry-run certification sin envio SII",
      source: "script",
    }),
  );

  const audit = buildAuditRecord({
    tenantId: draft.record.tenantId,
    taxDocumentId: draft.record.id,
    submissionId: submission.id,
    action: input.submitBlocked ? "sii_submit_blocked" : "sii_dry_run_trace",
    actorType: "script",
    metadata: { config: input.configSummary, steps: input.steps },
  });
  await repo.appendAuditLog(audit);

  const summary: DtePersistenceTraceSummary = {
    environment: "certification",
    dryRun: input.dryRun,
    xmlSha256,
    status: input.xml ? "xml_generated" : "draft",
    siiStatus: "not_sent",
    trackId: null,
    generatedAt: new Date().toISOString(),
    readiness: {
      globalStatus: readiness.globalStatus,
      labScore: readiness.labScore,
      certificationScore: readiness.certificationScore,
      productionTechnicalScore: readiness.productionTechnicalScore,
    },
    redactedConfig: safeJsonForAudit(input.configSummary),
    lastAuditAction: audit.action,
  };

  mkdirSync(dirname(input.outputPath), { recursive: true });
  writeFileSync(input.outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  if (backend === "supabase") {
    writeFileSync(
      `${input.outputPath}.backend`,
      "DTE_PERSISTENCE_BACKEND=supabase\n",
      "utf8",
    );
  }
  return summary;
}
