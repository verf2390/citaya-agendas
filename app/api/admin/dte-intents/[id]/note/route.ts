export const runtime = "nodejs";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const dteType = Number(body?.dteType);
  const reason = String(body?.reason ?? "").trim().slice(0, 500);
  const requestKey = String(req.headers.get("idempotency-key") ?? "").trim();
  const adjustmentAmount = Number(body?.adjustmentAmount);
  const referenceCode = String(body?.referenceCode ?? "");
  if (!isUuid(id) || ![56, 61].includes(dteType) || reason.length < 10 || requestKey.length < 16 || referenceCode !== "3" || body?.reviewAccepted !== true || !Number.isSafeInteger(adjustmentAmount) || adjustmentAmount <= 0) {
    return NextResponse.json({ ok: false, error: "Solicitud inválida" }, { status: 400 });
  }
  const { data: original } = await supabaseAdmin.from("dte_payment_document_intents")
    .select("id,appointment_id,customer_id,amount_snapshot,currency,receiver_snapshot,immutable_snapshot,production_document_id,resolved_dte_type,status")
    .eq("tenant_id", auth.tenantId).eq("id", id).eq("status", "ACCEPTED").maybeSingle();
  if (!original?.production_document_id || ![33, 39].includes(Number(original.resolved_dte_type)) || adjustmentAmount > Number(original.amount_snapshot)) {
    return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  }
  const [{ data: authorization }, { data: activation }] = await Promise.all([
    supabaseAdmin.from("dte_sii_authorization_evidence").select("authorized_types")
      .eq("tenant_id", auth.tenantId).eq("status", "current").maybeSingle(),
    supabaseAdmin.from("dte_legal_activation").select("status")
      .eq("tenant_id", auth.tenantId).eq("dte_type", dteType).maybeSingle(),
  ]);
  const authorized = Array.isArray(authorization?.authorized_types) &&
    authorization.authorized_types.includes(dteType);
  const active = activation?.status === "active" && process.env.DTE_PRODUCTION_ENABLED === "true";
  const blockingReason = !authorized ? "DOCUMENT_TYPE_NOT_AUTHORIZED"
    : !active ? "LEGAL_ISSUANCE_NOT_ACTIVE" : null;
  const idempotencyKey = createHash("sha256")
    .update([auth.tenantId, id, String(dteType), referenceCode, String(adjustmentAmount), reason.toLowerCase()].join("|"))
    .digest("hex");
  const origin = dteType === 61 ? "credit_note" : "debit_note";
  const originalSnapshot = (original.immutable_snapshot ?? {}) as Record<string, unknown>;
  const originalTaxes = originalSnapshot.taxes && typeof originalSnapshot.taxes === "object"
    ? originalSnapshot.taxes as Record<string, unknown> : {};
  const exempt = Number(originalTaxes.exempt ?? 0) > 0 && Number(originalTaxes.tax ?? 0) === 0;
  const netAmount = exempt ? 0 : Math.round(adjustmentAmount / 1.19);
  const taxAmount = exempt ? 0 : adjustmentAmount - netAmount;
  const snapshot = {
    ...originalSnapshot,
    tenantId: auth.tenantId,
    documentType: dteType,
    origin,
    requestedBy: auth.userId,
    requestedByRole: auth.authMode,
    requestedAt: new Date().toISOString(),
    operationalReason: reason,
    lines: [{ description: ("Ajuste tributario: " + reason).slice(0, 180), quantity: 1, unitPrice: adjustmentAmount }],
    taxes: { net: netAmount, exempt: exempt ? adjustmentAmount : 0, tax: taxAmount, total: adjustmentAmount },
    referenceCode,
    original: {
      intentId: original.id,
      productionDocumentId: original.production_document_id,
      documentType: original.resolved_dte_type,
    },
  };
  const { data: created, error } = await supabaseAdmin.from("dte_payment_document_intents")
    .insert({
      tenant_id: auth.tenantId,
      appointment_id: original.appointment_id,
      payment_intent_id: null,
      customer_id: original.customer_id,
      payment_key: `note:${id}:${idempotencyKey}`,
      trigger_source: "manual_admin",
      idempotency_key: idempotencyKey,
      requested_document: "invoice",
      resolved_dte_type: dteType,
      amount_snapshot: adjustmentAmount,
      currency: original.currency,
      appointment_snapshot: originalSnapshot.appointment ?? {},
      receiver_snapshot: original.receiver_snapshot,
      immutable_snapshot: snapshot,
      origin,
      operational_reason: reason,
      original_production_document_id: original.production_document_id,
      status: blockingReason ? "BLOCKED" : "PENDING",
      safe_blocking_reason: blockingReason,
      created_by: auth.userId,
      requested_by_role: auth.authMode === "platform_admin" ? "platform_admin" : "tenant_admin",
    }).select("id,status,safe_blocking_reason,resolved_dte_type").single();
  if (error) {
    const { data: existing } = await supabaseAdmin.from("dte_payment_document_intents")
      .select("id,status,safe_blocking_reason,resolved_dte_type")
      .eq("tenant_id", auth.tenantId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing) return NextResponse.json({ ok: true, intent: existing, duplicate: true });
    return NextResponse.json({ ok: false, error: "La nota ya existe o no puede crearse" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, intent: created, duplicate: false }, { status: 201 });
}
