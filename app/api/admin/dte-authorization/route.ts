export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { normalizeRut, validateRut } from "@/lib/dte/rut";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const { data, error } = await supabaseAdmin.from("dte_sii_authorization_evidence")
    .select("id,issuer_rut,authorization_date,authorized_types,evidence_source,evidence_fingerprint,registered_by,registered_at,observation,status,revoked_at")
    .eq("tenant_id", auth.tenantId).order("registered_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: "No se pudo cargar la autorización" }, { status: 503 });
  return NextResponse.json({ ok: true, evidence: data ?? [], canReconcile: auth.authMode === "platform_admin" });
}

export async function DELETE(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok || auth.authMode !== "platform_admin") {
    return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim().slice(0, 500);
  if (reason.length < 10) {
    return NextResponse.json({ ok: false, error: "Motivo de revocación obligatorio" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.rpc("dte_revoke_sii_authorization", {
    p_tenant_id: auth.tenantId, p_reason: reason, p_actor_id: auth.userId,
  });
  if (error) return NextResponse.json({ ok: false, error: "No se pudo revocar la autorización" }, { status: 409 });
  return NextResponse.json({ ok: true, revokedTypes: data });
}

export async function POST(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok || auth.authMode !== "platform_admin") {
    return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const issuerRut = String(body?.issuerRut ?? "").trim();
  const authorizedTypes: number[] = Array.isArray(body?.authorizedTypes)
    ? [...new Set<number>((body.authorizedTypes as unknown[]).map((value: unknown) => Number(value)))]
    : [];
  const authorizationDate = String(body?.authorizationDate ?? "");
  const evidenceSource = String(body?.evidenceSource ?? "").trim().slice(0, 300);
  const evidenceFingerprint = String(body?.evidenceFingerprint ?? "").trim().toLowerCase();
  const observation = String(body?.observation ?? "").trim().slice(0, 1000);
  if (
    !validateRut(issuerRut) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(authorizationDate) ||
    new Date(`${authorizationDate}T00:00:00Z`).getTime() > Date.now() ||
    !authorizedTypes.length ||
    authorizedTypes.some((type) => ![33, 39, 56, 61].includes(type)) ||
    evidenceSource.length < 3 ||
    !/^[a-f0-9]{64}$/.test(evidenceFingerprint)
  ) {
    return NextResponse.json({ ok: false, error: "Evidencia inválida" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.rpc("dte_register_sii_authorization", {
    p_tenant_id: auth.tenantId,
    p_issuer_rut: normalizeRut(issuerRut),
    p_authorization_date: authorizationDate,
    p_authorized_types: authorizedTypes,
    p_evidence_source: evidenceSource,
    p_evidence_fingerprint: evidenceFingerprint,
    p_observation: observation,
    p_actor_id: auth.userId,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "No se pudo reconciliar la autorización" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, evidenceId: data }, { status: 201 });
}
