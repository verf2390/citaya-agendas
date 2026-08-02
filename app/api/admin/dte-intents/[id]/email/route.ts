export const runtime = "nodejs";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { canEmailDte } from "@/lib/dte/cutover";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertTenantCanSendExternalCommunication } from "@/lib/tenant/operational-server";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  try { await assertTenantCanSendExternalCommunication(auth.tenantId); }
  catch { return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 }); }
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  const { data: intent } = await supabaseAdmin.from("dte_payment_document_intents")
    .select("id,status,production_document_id,receiver_snapshot")
    .eq("tenant_id", auth.tenantId).eq("id", id).maybeSingle();
  if (!intent?.production_document_id) {
    return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  }
  if (!canEmailDte(intent.status)) {
    return NextResponse.json({ ok: false, error: "El documento aún no está en un estado entregable" }, { status: 409 });
  }
  const email = String(intent.receiver_snapshot?.taxEmail ?? intent.receiver_snapshot?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "El receptor no tiene email tributario válido" }, { status: 409 });
  }
  const { data: artifacts } = await supabaseAdmin.from("dte_production_artifacts")
    .select("id,kind").eq("tenant_id", auth.tenantId)
    .eq("document_id", intent.production_document_id)
    .in("kind", ["dte_xml", "pdf"]);
  const xml = artifacts?.find((item) => item.kind === "dte_xml");
  const pdf = artifacts?.find((item) => item.kind === "pdf");
  if (!xml || !pdf) {
    return NextResponse.json({ ok: false, error: "Artefactos privados no disponibles" }, { status: 409 });
  }
  const idempotencyKey = createHash("sha256")
    .update(`${auth.tenantId}|${intent.production_document_id}|${req.headers.get("idempotency-key") ?? ""}`)
    .digest("hex");
  const { data: existing } = await supabaseAdmin.from("dte_production_recipient_outbox")
    .select("id").eq("tenant_id", auth.tenantId)
    .eq("document_id", intent.production_document_id).maybeSingle();
  const result = existing
    ? await supabaseAdmin.from("dte_production_recipient_outbox").update({
        recipient_email: email, idempotency_key: idempotencyKey,
        status: "pending", attempts: 0, delivered_at: null,
      }).eq("tenant_id", auth.tenantId).eq("id", existing.id)
    : await supabaseAdmin.from("dte_production_recipient_outbox").insert({
        tenant_id: auth.tenantId, document_id: intent.production_document_id,
        recipient_email: email, idempotency_key: idempotencyKey,
        status: "pending", xml_artifact_id: xml.id, pdf_artifact_id: pdf.id,
      });
  if (result.error) return NextResponse.json({ ok: false, error: "No se pudo encolar el email" }, { status: 409 });
  await supabaseAdmin.from("dte_document_events").insert({
    tenant_id: auth.tenantId, intent_id: id,
    production_document_id: intent.production_document_id,
    event_type: "RECIPIENT_EMAIL_REQUEUED", actor_id: auth.userId,
    safe_metadata: {},
  });
  return NextResponse.json({ ok: true });
}
