import { randomInt } from "node:crypto";
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
import type { DteRepository } from "./dte-repository";
import type { DtePersistenceBackend } from "./get-dte-repository";

export type SmokeTraceInput = {
  repoRoot: string;
  outputPath: string;
  dryRun: boolean;
  submitBlocked?: boolean;
  xml?: string | null;
  configSummary: Record<string, unknown>;
  steps: Array<{ name: string; status: string; message: string }>;
  repository?: DteRepository;
  backend?: DtePersistenceBackend;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  entropy?: number;
};

export type SmokeDocumentIdentity = {
  folio: number;
  paymentReference: string;
};

const MEMORY_SMOKE_TENANT_ID = "tenant-smoke-lab";
const MEMORY_SMOKE_FOLIO = 1001;

export function readSmokeTrace(
  outputPath: string,
): DtePersistenceTraceSummary | null {
  if (!existsSync(outputPath)) return null;
  const parsed = JSON.parse(
    readFileSync(outputPath, "utf8"),
  ) as DtePersistenceTraceSummary;
  return parsed;
}

export function getSmokeTenantId(
  backend: DtePersistenceBackend,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const smokeTenantId = env.DTE_SMOKE_TENANT_ID?.trim();

  if (backend === "supabase" && !smokeTenantId) {
    throw new Error(
      "DTE_SMOKE_TENANT_ID_REQUIRED_FOR_SUPABASE: define DTE_SMOKE_TENANT_ID en .env.dte-lab con el UUID real del tenant LAB.",
    );
  }

  return smokeTenantId || MEMORY_SMOKE_TENANT_ID;
}

export function buildSmokeDocumentIdentity(
  backend: DtePersistenceBackend,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
  entropy = randomInt(1_000, 9_999),
): SmokeDocumentIdentity {
  const configuredFolio = parseSmokeFolio(env.DTE_SMOKE_FOLIO);

  if (configuredFolio !== null) {
    return {
      folio: configuredFolio,
      paymentReference:
        backend === "supabase"
          ? `smoke-dry-run-${configuredFolio}-${nowMs}-${entropy}`
          : "smoke-dry-run",
    };
  }

  if (backend !== "supabase") {
    return { folio: MEMORY_SMOKE_FOLIO, paymentReference: "smoke-dry-run" };
  }

  const folio = 100_000 + ((nowMs + entropy) % 800_000);
  return {
    folio,
    paymentReference: `smoke-dry-run-${folio}-${nowMs}-${entropy}`,
  };
}

function parseSmokeFolio(value: string | undefined): number | null {
  if (!value) return null;
  const folio = Number(value);
  if (!Number.isSafeInteger(folio) || folio <= 0) {
    throw new Error(
      "DTE_SMOKE_FOLIO_INVALID: DTE_SMOKE_FOLIO debe ser un entero positivo para una prueba LAB controlada.",
    );
  }
  return folio;
}

export async function writeSmokeTrace(
  input: SmokeTraceInput,
): Promise<DtePersistenceTraceSummary> {
  const env = input.env ?? process.env;
  const backend = input.backend ?? getDtePersistenceBackend(env);
  const repo = input.repository ?? getDteRepository(env);
  const readiness = checkDteReadiness({ repoRoot: input.repoRoot });
  const xmlSha256 = input.xml ? sha256String(input.xml) : null;
  const smokeTenantId = getSmokeTenantId(backend, env);
  const documentIdentity = buildSmokeDocumentIdentity(
    backend,
    env,
    input.nowMs,
    input.entropy,
  );

  const draft = await repo.createTaxDocumentDraft({
    tenantId: smokeTenantId,
    documentType: "factura_afecta",
    folio: documentIdentity.folio,
    emitterRut: "76.123.456-0",
    emitterName: "Empresa Demo Citaya SpA",
    receiverRut: "11.111.111-1",
    receiverName: "Cliente Demo",
    issueDate: new Date().toISOString().slice(0, 10),
    totalAmount: 11900,
    netAmount: 10000,
    taxAmount: 1900,
    exemptAmount: 0,
    paymentReference: documentIdentity.paymentReference,
  });

  if (!draft.ok) {
    throw new Error(draft.error);
  }

  if (input.xml) {
    const xmlGenerated = await repo.markXmlGenerated({
      tenantId: draft.record.tenantId,
      taxDocumentId: draft.record.id,
      xml: input.xml,
      xmlStoragePath: null,
    });
    if (!xmlGenerated.ok) {
      throw new Error(xmlGenerated.error);
    }
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

  const submissionResult = await repo.createSiiSubmission(submission);
  if (!submissionResult.ok) {
    throw new Error(submissionResult.error);
  }

  const historyResult = await repo.appendStatusHistory(
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
  if (!historyResult.ok) {
    throw new Error(historyResult.error);
  }

  const audit = buildAuditRecord({
    tenantId: draft.record.tenantId,
    taxDocumentId: draft.record.id,
    submissionId: submission.id,
    action: input.submitBlocked ? "sii_submit_blocked" : "sii_dry_run_trace",
    actorType: "script",
    metadata: { config: input.configSummary, steps: input.steps },
  });

  const auditResult = await repo.appendAuditLog(audit);
  if (!auditResult.ok) {
    throw new Error(auditResult.error);
  }

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