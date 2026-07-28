export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function platformAuth(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok || auth.authMode !== "platform_admin") return null;
  return auth;
}

export async function GET(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const type = Number(new URL(req.url).searchParams.get("type") ?? "33");
  if (![33, 39, 56, 61].includes(type)) {
    return NextResponse.json({ ok: false, error: "Tipo inválido" }, { status: 400 });
  }
  const [{ data: report, error }, { data: activation }] = await Promise.all([
    supabaseAdmin.rpc("dte_activation_gate_report", {
      p_tenant_id: auth.tenantId,
      p_dte_type: type,
      p_global_feature_enabled: process.env.DTE_PRODUCTION_ENABLED === "true",
    }),
    supabaseAdmin.from("dte_legal_activation").select("status,activated_at,paused_at,pause_reason")
      .eq("tenant_id", auth.tenantId).eq("dte_type", type).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ ok: false, error: "Preflight no disponible" }, { status: 503 });
  return NextResponse.json({
    ok: true,
    type,
    gates: report,
    activation: activation ?? { status: "inactive" },
    canActivate: auth.authMode === "platform_admin",
    confirmationPrompt: auth.authMode === "platform_admin"
      ? `ACTIVAR EMISION LEGAL ${auth.tenantId} ${type}`
      : null,
  });
}

export async function POST(req: Request) {
  const auth = await platformAuth(req);
  if (!auth) return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const type = Number(body?.dteType);
  const expected = `ACTIVAR EMISION LEGAL ${auth.tenantId} ${type}`;
  if (![33, 39, 56, 61].includes(type) || body?.confirmation !== expected) {
    return NextResponse.json({ ok: false, error: "Confirmación inválida" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.rpc("dte_activate_legal_issuance", {
    p_tenant_id: auth.tenantId,
    p_dte_type: type,
    p_global_feature_enabled: process.env.DTE_PRODUCTION_ENABLED === "true",
    p_actor_id: auth.userId,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "Faltan gates operacionales o legales" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, gates: data });
}

export async function PATCH(req: Request) {
  const auth = await platformAuth(req);
  if (!auth) return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const type = Number(body?.dteType);
  const reason = String(body?.reason ?? "").trim();
  if (![33, 39, 56, 61].includes(type) || reason.length < 10) {
    return NextResponse.json({ ok: false, error: "Motivo de pausa obligatorio" }, { status: 400 });
  }
  const { error } = await supabaseAdmin.rpc("dte_pause_legal_issuance", {
    p_tenant_id: auth.tenantId,
    p_dte_type: type,
    p_reason: reason.slice(0, 500),
    p_actor_id: auth.userId,
  });
  if (error) return NextResponse.json({ ok: false, error: "No se pudo pausar" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
