import { expectedProductionConfirmation } from "@/lib/dte/production/config";
import { createServerProductionDteService } from "@/lib/dte/production/server";
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
  production_document_id: string | null;
  created_by: string | null;
};

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

async function block(item: ClaimedOutbox, reason: string, deterministicAttempts = item.deterministic_attempts) {
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("tenant_id", item.tenant_id);
  if (result.error) throw new Error("DTE_OUTBOX_PERSISTENCE_FAILED");
  await appendEvent(item, "ISSUANCE_BLOCKED", { reason });
}

async function loadIntent(item: ClaimedOutbox): Promise<IssuanceIntent> {
  const result = await supabaseAdmin
    .from("dte_payment_document_intents")
    .select("id,tenant_id,status,resolved_dte_type,amount_snapshot,appointment_snapshot,receiver_snapshot,production_document_id,created_by")
    .eq("id", item.intent_id)
    .eq("tenant_id", item.tenant_id)
    .single();
  if (result.error || !result.data) throw new Error("DTE_INTENT_NOT_FOUND");
  return result.data as IssuanceIntent;
}

async function finishOutbox(item: ClaimedOutbox, status: "COMPLETED" | "BLOCKED", networkAttempts: number, reason: string | null) {
  const result = await supabaseAdmin
    .from("dte_issuance_outbox")
    .update({
      status,
      network_attempts: networkAttempts,
      last_safe_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("tenant_id", item.tenant_id);
  if (result.error) throw new Error("DTE_OUTBOX_PERSISTENCE_FAILED");
}

export async function runOneAutomaticIssuanceWorker() {
  const globalProductionEnabled = process.env.DTE_PRODUCTION_ENABLED === "true";
  if (!globalProductionEnabled) return { processed: false, status: "DISABLED", siiContacted: false, networkAttempts: 0 };
  const claimed = await supabaseAdmin.rpc("dte_claim_issuance_outbox", {
    p_worker_id: `citaya:${process.pid}`,
  });
  if (claimed.error) throw new Error("DTE_OUTBOX_CLAIM_FAILED");
  const item = (Array.isArray(claimed.data) ? claimed.data[0] : null) as ClaimedOutbox | null;
  if (!item) return { processed: false, status: null, siiContacted: false, networkAttempts: 0 };

  let intent: IssuanceIntent | null = null;
  try {
    intent = await loadIntent(item);
    if (intent.status !== "PENDING" || intent.resolved_dte_type !== 33) {
      throw new Error("DTE_INTENT_STATE_INVALID");
    }
    const appointment = intent.appointment_snapshot ?? {};
    const receiver = intent.receiver_snapshot ?? {};
    const treatment = value(appointment, "taxTreatment");
    if (!Number.isSafeInteger(Number(intent.amount_snapshot)) || Number(intent.amount_snapshot) <= 0) {
      throw new Error("DTE_AMOUNT_SNAPSHOT_INVALID");
    }
    if (!['affected', 'exempt'].includes(treatment)) {
      throw new Error("DTE_TAX_TREATMENT_SNAPSHOT_REQUIRED");
    }

    const total = Number(intent.amount_snapshot);
    const unitPrice = treatment === "exempt" ? total : affectedNetFromGross(total);
    const actorId = intent.created_by ?? SYSTEM_ACTOR_ID;
    const service = createServerProductionDteService();
    const draft = intent.production_document_id
      ? { id: intent.production_document_id }
      : await service.createDraft({
          tenantId: item.tenant_id,
          dteType: 33,
          businessOperationId: `auto:${intent.id}`,
          recipient: {
            rut: value(receiver, "rut"),
            legalName: value(receiver, "legalName"),
            businessActivity: value(receiver, "activity"),
            address: value(receiver, "address"),
            commune: value(receiver, "commune"),
            city: value(receiver, "city"),
            email: value(receiver, "email"),
          },
          lines: [{
            name: value(appointment, "serviceName") || "Servicio reservado",
            quantity: 1,
            unitPrice,
            exempt: treatment === "exempt",
          }],
        }, actorId);

    intent.production_document_id = draft.id;
    await updateIntent(item, {
      status: "PREPARING",
      production_document_id: draft.id,
      safe_blocking_reason: null,
    });
    await appendEvent(item, "ISSUANCE_PREPARING", { productionDocumentId: draft.id, dteType: 33 });

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
    const reason = safeReason(error, "DTE_AUTOMATIC_PREPARATION_FAILED");
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
    await block(item, reason, Math.min(item.deterministic_attempts + 1, 3));
    return { processed: true, status: "BLOCKED", siiContacted: false, networkAttempts: 0 };
  }
}
