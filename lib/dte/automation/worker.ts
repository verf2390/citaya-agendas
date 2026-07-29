import { expectedProductionConfirmation } from "@/lib/dte/production/config";
import { createServerProductionDteService } from "@/lib/dte/production/server";
import { ProductionPreparationError } from "@/lib/dte/production/service";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-000000000001";

type ClaimedOutbox = {
  id: string;
  tenant_id: string;
  intent_id: string;
  deterministic_attempts: number;
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
  original_production_document_id: string | null;
  operational_reason: string | null;
  production_document_id: string | null;
  created_by: string | null;
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
    .select("id,tenant_id,status,resolved_dte_type,amount_snapshot,appointment_snapshot,receiver_snapshot,immutable_snapshot,original_production_document_id,operational_reason,production_document_id,created_by")
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

export async function runOneManualIssuanceWorker(options: {
  targetOutboxId?: string;
} = {}) {
  const globalProductionEnabled = process.env.DTE_PRODUCTION_ENABLED === "true";
  if (!globalProductionEnabled) return { processed: false, status: "DISABLED", siiContacted: false, networkAttempts: 0 };
  const targetOutboxId = String(options.targetOutboxId ?? "").trim();
  if (targetOutboxId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetOutboxId)) {
    throw new Error("DTE_TARGET_OUTBOX_INVALID");
  }
  const workerId = `citaya-manual:${process.pid}`;
  const claimed = targetOutboxId
    ? await supabaseAdmin.rpc("dte_claim_manual_issuance_outbox_exact", {
        p_worker_id: workerId,
        p_outbox_id: targetOutboxId,
      })
    : await supabaseAdmin.rpc("dte_claim_manual_issuance_outbox", {
        p_worker_id: workerId,
      });
  if (claimed.error) throw new Error("DTE_OUTBOX_CLAIM_FAILED");
  const item = (Array.isArray(claimed.data) ? claimed.data[0] : null) as ClaimedOutbox | null;
  if (!item) return { processed: false, status: null, siiContacted: false, networkAttempts: 0 };

  let intent: IssuanceIntent | null = null;
  try {
    intent = await loadIntent(item);
    if (intent.status !== "PENDING" || ![33, 56, 61].includes(Number(intent.resolved_dte_type))) {
      throw new Error("DTE_INTENT_STATE_INVALID");
    }
    const dteType = Number(intent.resolved_dte_type) as 33 | 56 | 61;
    await assertTenantReadyForIssuance(item, dteType);
    const appointment = intent.appointment_snapshot ?? {};
    const receiver = intent.receiver_snapshot ?? {};
    const immutable = intent.immutable_snapshot ?? {};
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
    const sourceLines = rawLines.length ? rawLines : [{
      description: value(appointment, "serviceName") || "Servicio reservado",
      quantity: 1,
      unitGrossAmount: grossAmount,
      grossAmount,
    }];
    const productionLines = sourceLines.map((candidate) => {
      if (!candidate || typeof candidate !== "object") throw new Error("DTE_LINES_INVALID");
      const line = candidate as Record<string, unknown>;
      const quantity = Number(line.quantity);
      const unitGrossAmount = Number(line.unitGrossAmount ?? line.unitPrice);
      const lineGrossAmount = Number(line.grossAmount ?? quantity * unitGrossAmount);
      const name = value(line, "description") || value(line, "name");
      if (
        !name || !Number.isInteger(quantity) || quantity < 1 ||
        !Number.isSafeInteger(unitGrossAmount) || unitGrossAmount <= 0 ||
        !Number.isSafeInteger(lineGrossAmount) || lineGrossAmount !== quantity * unitGrossAmount
      ) {
        throw new Error("DTE_LINES_INVALID");
      }
      return {
        name, quantity,
        unitPrice: treatment === "exempt" ? unitGrossAmount : affectedNetFromGross(unitGrossAmount),
        exempt: treatment === "exempt",
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
    const service = createServerProductionDteService();
    const draft = intent.production_document_id
      ? { id: intent.production_document_id }
      : await service.createDraft({
          tenantId: item.tenant_id,
          dteType,
          businessOperationId: `intent:${intent.id}`,
          recipient: {
            rut: value(receiver, "rut"),
            legalName: value(receiver, "legalName"),
            businessActivity: value(receiver, "activity") || value(receiver, "businessActivity"),
            address: value(receiver, "address"),
            commune: value(receiver, "commune"),
            city: value(receiver, "city"),
            email: value(receiver, "taxEmail") || value(receiver, "email"),
          },
          lines: productionLines,
          references,
        }, actorId);

    if ("totalAmount" in draft && Number(draft.totalAmount) !== grossAmount) {
      throw new Error("DTE_AMOUNT_TAX_RECONCILIATION_FAILED");
    }
    intent.production_document_id = draft.id;
    await updateIntent(item, {
      status: "PREPARING",
      production_document_id: draft.id,
      safe_blocking_reason: null,
    });
    await appendEvent(item, "ISSUANCE_PREPARING", { productionDocumentId: draft.id, dteType });

    await service.prepare(item.tenant_id, draft.id, actorId);
    await updateIntent(item, { status: "READY" });
    await appendEvent(item, "ISSUANCE_READY", { productionDocumentId: draft.id });

    await updateIntent(item, { status: "SUBMITTING", network_attempt_count: 1 });
    await appendEvent(item, "SUBMISSION_STARTED", { automaticRetry: false });
    const emitted = await service.emitOnce({
      tenantId: item.tenant_id,
      documentId: draft.id,
      confirmation: expectedProductionConfirmation(draft.id),
      actorId,
    });
    const finalStatus = emitted.status.toUpperCase();
    if (finalStatus === "AMBIGUOUS") {
      await supabaseAdmin.rpc("dte_mark_ambiguous_no_retry", {
        p_tenant_id: item.tenant_id,
        p_intent_id: item.intent_id,
        p_safe_reason: "AMBIGUOUS_REQUIRES_RECONCILIATION",
      });
      return { processed: true, status: "AMBIGUOUS", siiContacted: true, networkAttempts: 1 };
    }
    const status = finalStatus === "SUBMITTED" ? "SUBMITTED" : "REJECTED";
    await updateIntent(item, { status, safe_blocking_reason: status === "REJECTED" ? "SII_EXPLICIT_REJECTION" : null });
    await finishOutbox(item, "COMPLETED", 1, status === "REJECTED" ? "SII_EXPLICIT_REJECTION" : null);
    await appendEvent(item, `SUBMISSION_${status}`, { automaticRetry: false });
    return { processed: true, status, siiContacted: true, networkAttempts: 1 };
  } catch (error) {
    const reason = safeReason(error, "DTE_MANUAL_PREPARATION_FAILED");
    const productionDocumentId = intent?.production_document_id;
    if (productionDocumentId) {
      const attempt = await supabaseAdmin
        .from("dte_production_submission_attempts")
        .select("before_fetch_at")
        .eq("tenant_id", item.tenant_id)
        .eq("document_id", productionDocumentId)
        .maybeSingle();
      if (attempt.data?.before_fetch_at) {
        await supabaseAdmin.rpc("dte_mark_ambiguous_no_retry", {
          p_tenant_id: item.tenant_id,
          p_intent_id: item.intent_id,
          p_safe_reason: "NETWORK_RESULT_UNKNOWN",
        });
        return { processed: true, status: "AMBIGUOUS", siiContacted: true, networkAttempts: 1 };
      }
    }
    await block(item, reason, Math.min(item.deterministic_attempts + 1, 3),
      safeFailureDetails(error));
    return { processed: true, status: "BLOCKED", siiContacted: false, networkAttempts: 0 };
  }
}
