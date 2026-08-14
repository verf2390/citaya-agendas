import { expectedProductionConfirmation } from "@/lib/dte/production/config";
import { createServerProductionDteService } from "@/lib/dte/production/server";
import { ProductionPreparationError } from "@/lib/dte/production/service";
import type { ProductionDteService } from "@/lib/dte/production/service";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertTenantCanRunDteWorker } from "@/lib/tenant/operational-server";
import { randomUUID } from "node:crypto";

const SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-000000000001";

export type ClaimedOutbox = {
  id: string;
  tenant_id: string;
  intent_id: string;
  deterministic_attempts: number;
  issuance_origin?: string;
  locked_by?: string | null;
  claim_token?: string | null;
};

export type ManualWorkerOptions = {
  targetOutboxId?: string;
  controlledResume?: {
    intentId: string;
    documentId: string;
    folio: number;
    grossAmount: number;
    netAmount: number;
    taxAmount: number;
  };
};

export type DteWorkerResult = {
  processed: boolean;
  status: string | null;
  siiContacted: boolean;
  networkAttempts: number;
};

export type DteWorkerDependencies = {
  claimManual: (options: ManualWorkerOptions) => Promise<ClaimedOutbox | null>;
  claimAutomatic: () => Promise<ClaimedOutbox | null>;
  processClaimed: (item: ClaimedOutbox) => Promise<DteWorkerResult>;
};

export type ProcessClaimedDteItemOptions = {
  createProductionService?: () => ProductionDteService;
};

type IssuanceIntent = {
  id: string;
  tenant_id: string;
  status: string;
  resolved_dte_type: number | null;
  amount_snapshot: number;
  appointment_snapshot: Record<string, unknown>;
  receiver_snapshot: Record<string, unknown>;
  immutable_snapshot: Record<string, unknown>;
  customer_id: string | null;
  original_production_document_id: string | null;
  operational_reason: string | null;
  production_document_id: string | null;
  created_by: string | null;
};

type CommercialCustomerSnapshot = {
  customer_id: string;
  customer_name: string;
  customer_rut: string | null;
  customer_email: string | null;
  customer_phone: string | null;
};

type SafeFailureDetails = {
  failureStage: string;
  safeErrorCode: string;
  errorName: string;
  errorCode: string | null;
  causeName: string | null;
  causeCode: string | null;
  stack: string[];
};

function safeToken(value: unknown): string | null {
  const token = String(value ?? "").trim();
  return /^[A-Z0-9_:-]{2,180}$/i.test(token) ? token : null;
}

function safeFailureDetails(error: unknown): SafeFailureDetails {
  const failure = error instanceof Error ? error : new Error("DTE_UNKNOWN_ERROR");
  const cause = failure.cause instanceof Error ? failure.cause : null;
  const safeErrorCode = error instanceof ProductionPreparationError
    ? error.code
    : safeToken(failure.message) ?? "DTE_MANUAL_PREPARATION_FAILED";
  return {
    failureStage: error instanceof ProductionPreparationError
      ? error.failureStage
      : "worker",
    safeErrorCode,
    errorName: safeToken(failure.name) ?? "Error",
    errorCode: safeToken((failure as Error & { code?: unknown }).code),
    causeName: cause ? safeToken(cause.name) : null,
    causeCode: cause
      ? safeToken((cause as Error & { code?: unknown }).code ?? cause.message)
      : null,
    stack: String(failure.stack ?? "").split("\n").slice(0, 8)
      .map((line) => line.replaceAll(process.cwd(), "<repo>").trim())
      .filter((line) => /^[A-Za-z0-9_:.<>()/ -]{1,300}$/.test(line)),
  };
}

function safeReason(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_:=-]{2,180}$/.test(message) ? message : fallback;
}

function value(record: Record<string, unknown>, key: string) {
  return String(record[key] ?? "").trim();
}

function affectedNetFromGross(gross: number) {
  const approximate = Math.round((gross * 100) / 119);
  for (let candidate = Math.max(0, approximate - 2); candidate <= approximate + 2; candidate += 1) {
    if (candidate + Math.round(candidate * 0.19) === gross) return candidate;
  }
  throw new Error("DTE_AMOUNT_TAX_RECONCILIATION_FAILED");
}

function isAutomaticClaim(item: ClaimedOutbox) {
  return item.issuance_origin === "automatic_system";
}

function automaticClaimIdentity(item: ClaimedOutbox) {
  const workerId = String(item.locked_by ?? "");
  const claimToken = String(item.claim_token ?? "");
  if (!/^[A-Za-z0-9:_-]{3,100}$/.test(workerId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimToken)) {
    throw new Error("DTE_AUTOMATIC_CLAIM_FENCED");
  }
  return { workerId, claimToken };
}

async function mutateAutomaticClaim(item: ClaimedOutbox, input: {
  action: "RENEW" | "PREPARING" | "READY" | "SUBMITTING" | "NETWORK_BOUNDARY" | "COMPLETE" | "BLOCK" | "AMBIGUOUS";
  productionDocumentId?: string | null;
  finalStatus?: "SUBMITTED" | "REJECTED" | null;
  safeReason?: string | null;
  deterministicAttempts?: number | null;
  eventType?: string | null;
  safeMetadata?: Record<string, unknown>;
  submissionAttemptId?: string | null;
  networkMilestone?: "seed_before_fetch" | "token_before_fetch" | "upload_before_fetch" | null;
}) {
  const identity = automaticClaimIdentity(item);
  const result = await supabaseAdmin.rpc("dte_mutate_automatic_issuance_claim", {
    p_outbox_id: item.id,
    p_worker_id: identity.workerId,
    p_claim_token: identity.claimToken,
    p_action: input.action,
    p_production_document_id: input.productionDocumentId ?? null,
    p_final_status: input.finalStatus ?? null,
    p_safe_reason: input.safeReason ?? null,
    p_deterministic_attempts: input.deterministicAttempts ?? null,
    p_event_type: input.eventType ?? null,
    p_safe_metadata: input.safeMetadata ?? {},
    p_submission_attempt_id: input.submissionAttemptId ?? null,
    p_network_milestone: input.networkMilestone ?? null,
  });
  if (result.error || !result.data) throw new Error("DTE_AUTOMATIC_CLAIM_FENCED");
}

async function appendEvent(item: ClaimedOutbox, eventType: string, metadata: Record<string, unknown> = {}) {
  const result = await supabaseAdmin.from("dte_document_events").insert({
    tenant_id: item.tenant_id,
    intent_id: item.intent_id,
    event_type: eventType,
    safe_metadata: metadata,
  });
  if (result.error) throw new Error("DTE_EVENT_PERSISTENCE_FAILED");
}

async function updateIntent(item: ClaimedOutbox, patch: Record<string, unknown>) {
  const result = await supabaseAdmin
    .from("dte_payment_document_intents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", item.intent_id)
    .eq("tenant_id", item.tenant_id);
  if (result.error) throw new Error("DTE_INTENT_PERSISTENCE_FAILED");
}

async function block(
  item: ClaimedOutbox,
  reason: string,
  deterministicAttempts = item.deterministic_attempts,
  failure: SafeFailureDetails | null = null,
) {
  if (isAutomaticClaim(item)) {
    await mutateAutomaticClaim(item, {
      action: "BLOCK",
      safeReason: reason,
      deterministicAttempts: Math.min(Math.max(deterministicAttempts, 0), 3),
      eventType: "ISSUANCE_BLOCKED",
      safeMetadata: { reason, ...(failure ?? {}) },
    });
    return;
  }
  await updateIntent(item, {
    status: "BLOCKED",
    safe_blocking_reason: reason,
    deterministic_retry_count: Math.min(Math.max(deterministicAttempts, 0), 3),
  });
  const result = await supabaseAdmin
    .from("dte_issuance_outbox")
    .update({
      status: "BLOCKED",
      deterministic_attempts: Math.min(Math.max(deterministicAttempts, 0), 3),
      last_safe_error: reason,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("tenant_id", item.tenant_id);
  if (result.error) throw new Error("DTE_OUTBOX_PERSISTENCE_FAILED");
  await appendEvent(item, "ISSUANCE_BLOCKED", { reason, ...(failure ?? {}) });
}

async function loadIntent(item: ClaimedOutbox): Promise<IssuanceIntent> {
  const result = await supabaseAdmin
    .from("dte_payment_document_intents")
    .select("id,tenant_id,status,resolved_dte_type,amount_snapshot,appointment_snapshot,receiver_snapshot,immutable_snapshot,customer_id,original_production_document_id,operational_reason,production_document_id,created_by")
    .eq("id", item.intent_id)
    .eq("tenant_id", item.tenant_id)
    .single();
  if (result.error || !result.data) throw new Error("DTE_INTENT_NOT_FOUND");
  return result.data as IssuanceIntent;
}

async function assertTenantReadyForIssuance(item: ClaimedOutbox, dteType: number) {
  const [gateResult, activationResult] = await Promise.all([
    supabaseAdmin.rpc("dte_activation_gate_report", {
      p_tenant_id: item.tenant_id, p_dte_type: dteType, p_global_feature_enabled: true,
    }),
    supabaseAdmin.from("dte_legal_activation").select("status")
      .eq("tenant_id", item.tenant_id).eq("dte_type", dteType).maybeSingle(),
  ]);
  if (gateResult.error || activationResult.error) throw new Error("DTE_TENANT_READINESS_FAILED");
  const gates = gateResult.data as { ready?: boolean } | null;
  if (gates?.ready !== true || activationResult.data?.status !== "active")
    throw new Error("DTE_TENANT_NOT_READY_FOR_ISSUANCE");
}

async function finishOutbox(item: ClaimedOutbox, status: "COMPLETED" | "BLOCKED", networkAttempts: number, reason: string | null) {
  const result = await supabaseAdmin
    .from("dte_issuance_outbox")
    .update({
      status,
      network_attempts: networkAttempts,
      last_safe_error: reason,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("tenant_id", item.tenant_id);
  if (result.error) throw new Error("DTE_OUTBOX_PERSISTENCE_FAILED");
}

async function markAmbiguousNoRetry(item: ClaimedOutbox, reason: string) {
  if (isAutomaticClaim(item)) {
    await mutateAutomaticClaim(item, {
      action: "AMBIGUOUS",
      safeReason: reason,
      eventType: "SUBMISSION_AMBIGUOUS",
      safeMetadata: { automaticRetry: false, reason },
    });
    return;
  }
  await updateIntent(item, {
    status: "AMBIGUOUS",
    safe_blocking_reason: reason,
    network_attempt_count: 1,
  });
  const outboxResult = await supabaseAdmin
    .from("dte_issuance_outbox")
    .update({
      status: "BLOCKED",
      network_attempts: 1,
      last_safe_error: "AMBIGUOUS_REQUIRES_RECONCILIATION",
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("tenant_id", item.tenant_id)
    .in("status", ["PENDING", "PROCESSING", "BLOCKED"]);
  if (outboxResult.error) throw new Error("DTE_AMBIGUOUS_OUTBOX_PERSISTENCE_FAILED");
  await appendEvent(item, "SUBMISSION_AMBIGUOUS", {
    automaticRetry: false,
    reason,
  });
}

async function claimManualIssuance(options: ManualWorkerOptions): Promise<ClaimedOutbox | null> {
  const targetOutboxId = String(options.targetOutboxId ?? "").trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const resume = options.controlledResume;
  if (targetOutboxId && !uuid.test(targetOutboxId)) {
    throw new Error("DTE_TARGET_OUTBOX_INVALID");
  }
  if (resume && (
    !targetOutboxId || !uuid.test(resume.intentId) ||
    !uuid.test(resume.documentId) ||
    !Number.isSafeInteger(resume.folio) || resume.folio < 1 ||
    ![resume.grossAmount, resume.netAmount, resume.taxAmount]
      .every((amount) => Number.isSafeInteger(amount) && amount >= 0) ||
    resume.grossAmount !== resume.netAmount + resume.taxAmount
  )) throw new Error("DTE_CONTROLLED_RESUME_INVALID");
  const workerId = `citaya-manual:${process.pid}`;
  const claimed = resume
    ? await supabaseAdmin.rpc("dte_claim_manual_xsd_resume_exact", {
        p_worker_id: workerId,
        p_outbox_id: targetOutboxId,
        p_intent_id: resume.intentId,
        p_document_id: resume.documentId,
        p_expected_folio: resume.folio,
        p_expected_gross: resume.grossAmount,
        p_expected_net: resume.netAmount,
        p_expected_tax: resume.taxAmount,
      })
    : targetOutboxId
    ? await supabaseAdmin.rpc("dte_claim_manual_issuance_outbox_exact", {
        p_worker_id: workerId,
        p_outbox_id: targetOutboxId,
      })
    : await supabaseAdmin.rpc("dte_claim_manual_issuance_outbox", {
        p_worker_id: workerId,
      });
  if (claimed.error) throw new Error("DTE_OUTBOX_CLAIM_FAILED");
  return (Array.isArray(claimed.data) ? claimed.data[0] : null) as ClaimedOutbox | null;
}

async function claimAutomaticIssuance(): Promise<ClaimedOutbox | null> {
  const workerId = `citaya-automatic:${process.pid}:${randomUUID()}`;
  const claimed = await supabaseAdmin.rpc("dte_claim_automatic_issuance_outbox", {
    p_worker_id: workerId,
  });
  if (claimed.error) throw new Error("DTE_AUTOMATIC_OUTBOX_CLAIM_FAILED");
  const item = (Array.isArray(claimed.data) ? claimed.data[0] : null) as ClaimedOutbox | null;
  if (item && (item.issuance_origin !== "automatic_system" || item.locked_by !== workerId)) {
    throw new Error("DTE_AUTOMATIC_CLAIM_DOMAIN_INVALID");
  }
  if (item) automaticClaimIdentity(item);
  return item;
}

export async function processClaimedDteItem(
  item: ClaimedOutbox,
  options: ProcessClaimedDteItemOptions = {},
): Promise<DteWorkerResult> {
  const automatic = isAutomaticClaim(item);
  if (automatic) {
    automaticClaimIdentity(item);
    await mutateAutomaticClaim(item, { action: "RENEW" });
  }

  try {
    await assertTenantCanRunDteWorker(item.tenant_id, { issuanceOrigin: item.issuance_origin });
  } catch {
    await block(item, "TENANT_MODE_DTE_WORKER_BLOCKED");
    return { processed: true, status: "BLOCKED", siiContacted: false, networkAttempts: 0 };
  }

  let intent: IssuanceIntent | null = null;
  try {
    intent = await loadIntent(item);
    const allowedTypes = automatic ? [33, 39] : [33, 39, 56, 61];
    if (intent.status !== "PENDING" || !allowedTypes.includes(Number(intent.resolved_dte_type))) {
      throw new Error("DTE_INTENT_STATE_INVALID");
    }
    const dteType = Number(intent.resolved_dte_type) as 33 | 39 | 56 | 61;
    await assertTenantReadyForIssuance(item, dteType);
    const receiver = intent.receiver_snapshot ?? {};
    let commercialCustomer: CommercialCustomerSnapshot | null = null;
    if (dteType === 39) {
      const commercialResult = await supabaseAdmin
        .from("dte_boleta39_commercial_customer_snapshots")
        .select("customer_id,customer_name,customer_rut,customer_email,customer_phone")
        .eq("tenant_id", item.tenant_id)
        .eq("intent_id", intent.id)
        .maybeSingle();
      if (commercialResult.error || !commercialResult.data) {
        throw new Error("DTE_BOLETA39_CUSTOMER_SNAPSHOT_REQUIRED");
      }
      commercialCustomer = commercialResult.data as CommercialCustomerSnapshot;
    }
    const immutable = intent.immutable_snapshot ?? {};
    const frozenIssuer =
      immutable.issuer && typeof immutable.issuer === "object"
        ? immutable.issuer as Record<string, unknown>
        : {};
    const moneySnapshot = immutable.money && typeof immutable.money === "object"
      ? immutable.money as Record<string, unknown>
      : {};
    const legacyTaxes = immutable.taxes && typeof immutable.taxes === "object"
      ? immutable.taxes as Record<string, unknown>
      : {};
    const grossAmount = Number(intent.amount_snapshot);
    const snapshotGrossAmount = Number(moneySnapshot.grossAmount ?? legacyTaxes.total ?? grossAmount);
    const snapshotNetAmount = Number(moneySnapshot.netAmount ?? legacyTaxes.net ?? 0);
    const snapshotExemptAmount = Number(moneySnapshot.exemptAmount ?? legacyTaxes.exempt ?? 0);
    const snapshotTaxAmount = Number(moneySnapshot.taxAmount ?? legacyTaxes.tax ?? 0);
    if (
      ![grossAmount, snapshotGrossAmount, snapshotNetAmount, snapshotExemptAmount, snapshotTaxAmount]
        .every((amount) => Number.isSafeInteger(amount) && amount >= 0) ||
      grossAmount <= 0 ||
      snapshotGrossAmount !== grossAmount ||
      snapshotNetAmount + snapshotExemptAmount + snapshotTaxAmount !== grossAmount
    ) {
      throw new Error("DTE_AMOUNT_SNAPSHOT_INVALID");
    }
    const treatment = snapshotExemptAmount === grossAmount ? "exempt" : "affected";

    const rawLines = Array.isArray(immutable.lines) ? immutable.lines : [];
    if (!rawLines.length) throw new Error("DTE_TAX_DESCRIPTION_SNAPSHOT_REQUIRED");
    const sourceLines = rawLines;
    const productionLines = sourceLines.map((candidate) => {
      if (!candidate || typeof candidate !== "object") throw new Error("DTE_LINES_INVALID");
      const line = candidate as Record<string, unknown>;
      const quantity = Number(line.quantity);
      const hasNetContract = line.unitNetAmount !== undefined;
      const sourceUnitAmount = Number(
        hasNetContract ? line.unitNetAmount : line.unitGrossAmount ?? line.unitPrice,
      );
      const lineGrossAmount = Number(
        line.grossAmount ?? quantity * sourceUnitAmount,
      );
      const name = value(line, "description") || value(line, "name");
      const discountBasisPoints = Number(line.discountBasisPoints ?? 0);
      if (
        !name || !Number.isInteger(quantity) || quantity < 1 ||
        !Number.isSafeInteger(sourceUnitAmount) || sourceUnitAmount <= 0 ||
        !Number.isSafeInteger(lineGrossAmount) ||
        !Number.isSafeInteger(discountBasisPoints) ||
        discountBasisPoints < 0 ||
        discountBasisPoints > 10_000 ||
        (!hasNetContract && lineGrossAmount !== quantity * sourceUnitAmount)
      ) {
        throw new Error("DTE_LINES_INVALID");
      }
      const unitGross = Number(
        line.unitGrossAmount ?? (hasNetContract ? Math.round(sourceUnitAmount * 1.19) : sourceUnitAmount),
      );
      return {
        name, quantity,
        unitPrice: hasNetContract
          ? sourceUnitAmount
          : treatment === "exempt"
            ? sourceUnitAmount
            : affectedNetFromGross(sourceUnitAmount),
        unitGrossAmount: unitGross,
        exempt: treatment === "exempt",
        discountPercent: discountBasisPoints / 100,
      };
    });
    let references: Array<{ code: string; reason: string; documentType: string; folio: string; date: string }> | undefined;
    if ([56, 61].includes(dteType)) {
      if (!intent.original_production_document_id || value(immutable, "referenceCode") !== "3") {
        throw new Error("DTE_REFERENCE_REQUIRED");
      }
      const originalResult = await supabaseAdmin.from("dte_production_documents")
        .select("dte_type,folio,issue_date")
        .eq("tenant_id", item.tenant_id)
        .eq("id", intent.original_production_document_id)
        .maybeSingle();
      const original = originalResult.data;
      if (originalResult.error || !original || !original.folio) throw new Error("DTE_ORIGINAL_DOCUMENT_NOT_FOUND");
      const reason = value(immutable, "operationalReason") || String(intent.operational_reason ?? "").trim();
      if (reason.length < 10) throw new Error("DTE_REFERENCE_REASON_REQUIRED");
      references = [{
        code: "3", reason: reason.slice(0, 90), documentType: String(original.dte_type),
        folio: String(original.folio), date: String(original.issue_date),
      }];
    }
    const actorId = intent.created_by ?? SYSTEM_ACTOR_ID;
    const service = (options.createProductionService ?? createServerProductionDteService)();
    const assertAutomaticMutationLease = automatic
      ? async () => mutateAutomaticClaim(item, { action: "RENEW" })
      : undefined;
    if (automatic) await mutateAutomaticClaim(item, { action: "RENEW" });
    const draft = intent.production_document_id
      ? { id: intent.production_document_id }
      : await service.createDraft({
          tenantId: item.tenant_id,
          dteType,
          businessOperationId: `intent:${intent.id}`,
          issuerSnapshot: {
            rut: value(frozenIssuer, "rut"),
            legalName: value(frozenIssuer, "legalName"),
            businessActivity:
              value(frozenIssuer, "businessActivity") ||
              value(frozenIssuer, "activity"),
            businessActivityCode:
              value(frozenIssuer, "businessActivityCode") || null,
            address: value(frozenIssuer, "address"),
            commune: value(frozenIssuer, "commune"),
            city: value(frozenIssuer, "city"),
            resolutionDate: value(frozenIssuer, "resolutionDate"),
            resolutionNumber: value(frozenIssuer, "resolutionNumber"),
            siiOffice: value(frozenIssuer, "siiOffice") || null,
          },
          taxSnapshotAt: value(immutable, "capturedAt"),
          recipient: {
            rut: commercialCustomer?.customer_rut || value(receiver, "rut") || "66666666-6",
            legalName: commercialCustomer?.customer_name || value(receiver, "legalName") || "Consumidor Final",
            businessActivity: value(receiver, "activity") || value(receiver, "businessActivity"),
            address: value(receiver, "address"),
            commune: value(receiver, "commune"),
            city: value(receiver, "city"),
            email: commercialCustomer?.customer_email || value(receiver, "taxEmail") || value(receiver, "email"),
          },
          lines: productionLines,
          references,
        }, actorId, assertAutomaticMutationLease);

    if ("totalAmount" in draft && Number(draft.totalAmount) !== grossAmount) {
      throw new Error("DTE_AMOUNT_TAX_RECONCILIATION_FAILED");
    }
    intent.production_document_id = draft.id;
    if (automatic) {
      await mutateAutomaticClaim(item, {
        action: "PREPARING",
        productionDocumentId: draft.id,
        eventType: "ISSUANCE_PREPARING",
        safeMetadata: { productionDocumentId: draft.id, dteType },
      });
    } else {
      await updateIntent(item, {
        status: "PREPARING",
        production_document_id: draft.id,
        safe_blocking_reason: null,
      });
      await appendEvent(item, "ISSUANCE_PREPARING", { productionDocumentId: draft.id, dteType });
    }

    if (automatic) await mutateAutomaticClaim(item, { action: "RENEW" });
    await service.prepare(
      item.tenant_id,
      draft.id,
      actorId,
      assertAutomaticMutationLease,
    );
    if (automatic) {
      await mutateAutomaticClaim(item, {
        action: "READY",
        productionDocumentId: draft.id,
        eventType: "ISSUANCE_READY",
        safeMetadata: { productionDocumentId: draft.id },
      });
    } else {
      await updateIntent(item, { status: "READY" });
      await appendEvent(item, "ISSUANCE_READY", { productionDocumentId: draft.id });
    }

    if (automatic) {
      await mutateAutomaticClaim(item, {
        action: "SUBMITTING",
        productionDocumentId: draft.id,
        eventType: "SUBMISSION_STARTED",
        safeMetadata: { automaticRetry: false },
      });
    } else {
      await updateIntent(item, { status: "SUBMITTING", network_attempt_count: 1 });
      await appendEvent(item, "SUBMISSION_STARTED", { automaticRetry: false });
    }
    const emitted = await service.emitOnce({
      tenantId: item.tenant_id,
      documentId: draft.id,
      confirmation: expectedProductionConfirmation(draft.id),
      actorId,
      assertMutationLease: assertAutomaticMutationLease,
      beforeNetworkAttempt: automatic
        ? async ({ milestone, submissionAttemptId }) => {
            await mutateAutomaticClaim(item, {
              action: "NETWORK_BOUNDARY",
              productionDocumentId: draft.id,
              submissionAttemptId,
              networkMilestone: milestone,
            });
          }
        : undefined,
    });
    const finalStatus = emitted.status.toUpperCase();
    if (finalStatus === "AMBIGUOUS") {
      await markAmbiguousNoRetry(item, "AMBIGUOUS_REQUIRES_RECONCILIATION");
      return { processed: true, status: "AMBIGUOUS", siiContacted: true, networkAttempts: 1 };
    }
    const status = finalStatus === "SUBMITTED" ? "SUBMITTED" : "REJECTED";
    if (automatic) {
      await mutateAutomaticClaim(item, {
        action: "COMPLETE",
        productionDocumentId: draft.id,
        finalStatus: status,
        safeReason: status === "REJECTED" ? "SII_EXPLICIT_REJECTION" : null,
        eventType: `SUBMISSION_${status}`,
        safeMetadata: { automaticRetry: false },
      });
    } else {
      await updateIntent(item, { status, safe_blocking_reason: status === "REJECTED" ? "SII_EXPLICIT_REJECTION" : null });
      await finishOutbox(item, "COMPLETED", 1, status === "REJECTED" ? "SII_EXPLICIT_REJECTION" : null);
      await appendEvent(item, `SUBMISSION_${status}`, { automaticRetry: false });
    }
    return { processed: true, status, siiContacted: true, networkAttempts: 1 };
  } catch (error) {
    const reason = safeReason(error, "DTE_MANUAL_PREPARATION_FAILED");
    const productionDocumentId = intent?.production_document_id;
    if (reason === "DTE_AUTOMATIC_CLAIM_FENCED") {
      let siiContacted = false;
      if (productionDocumentId) {
        const attempt = await supabaseAdmin
          .from("dte_production_submission_attempts")
          .select("before_fetch_at")
          .eq("tenant_id", item.tenant_id)
          .eq("document_id", productionDocumentId)
          .maybeSingle();
        siiContacted = Boolean(attempt.data?.before_fetch_at);
      }
      return {
        processed: true,
        status: "FENCED",
        siiContacted,
        networkAttempts: siiContacted ? 1 : 0,
      };
    }
    if (productionDocumentId) {
      const attempt = await supabaseAdmin
        .from("dte_production_submission_attempts")
        .select("before_fetch_at")
        .eq("tenant_id", item.tenant_id)
        .eq("document_id", productionDocumentId)
        .maybeSingle();
      if (attempt.data?.before_fetch_at) {
        await markAmbiguousNoRetry(item, "NETWORK_RESULT_UNKNOWN");
        return { processed: true, status: "AMBIGUOUS", siiContacted: true, networkAttempts: 1 };
      }
    }
    await block(item, reason, Math.min(item.deterministic_attempts + 1, 3),
      safeFailureDetails(error));
    return { processed: true, status: "BLOCKED", siiContacted: false, networkAttempts: 0 };
  }
}

const defaultWorkerDependencies: DteWorkerDependencies = {
  claimManual: claimManualIssuance,
  claimAutomatic: claimAutomaticIssuance,
  processClaimed: processClaimedDteItem,
};

export async function runOneManualIssuanceWorker(
  options: ManualWorkerOptions = {},
  dependencies: DteWorkerDependencies = defaultWorkerDependencies,
): Promise<DteWorkerResult> {
  if (process.env.DTE_PRODUCTION_ENABLED !== "true") {
    return { processed: false, status: "DISABLED", siiContacted: false, networkAttempts: 0 };
  }
  const item = await dependencies.claimManual(options);
  if (!item) return { processed: false, status: null, siiContacted: false, networkAttempts: 0 };
  return dependencies.processClaimed(item);
}

export async function runOneAutomaticIssuanceWorker(
  dependencies: DteWorkerDependencies = defaultWorkerDependencies,
): Promise<DteWorkerResult> {
  if (
    process.env.DTE_PRODUCTION_ENABLED !== "true" ||
    process.env.DTE_AUTOMATIC_WORKER_ENABLED !== "true"
  ) {
    return { processed: false, status: "DISABLED", siiContacted: false, networkAttempts: 0 };
  }
  const item = await dependencies.claimAutomatic();
  if (!item) return { processed: false, status: null, siiContacted: false, networkAttempts: 0 };
  if (!isAutomaticClaim(item)) throw new Error("DTE_AUTOMATIC_CLAIM_DOMAIN_INVALID");
  return dependencies.processClaimed(item);
}
