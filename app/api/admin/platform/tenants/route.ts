import { NextResponse } from "next/server";

import { requirePlatformAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveTenantOperationalCapabilities } from "@/lib/tenant/operational-mode.mjs";

function error(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if (!auth.ok) return error(auth.status, auth.error);
  const { data: tenants, error: tenantError } = await supabaseAdmin.from("tenants")
    .select("id,name,slug,lifecycle_status,operational_mode,operational_mode_changed_at,operational_mode_changed_by,operational_mode_change_reason")
    .order("created_at", { ascending: true });
  if (tenantError) return error(503, "No se pudo cargar la clasificación");
  const rows = await Promise.all((tenants ?? []).map(async (tenant) => {
    const { data: readiness } = await supabaseAdmin.rpc("tenant_live_readiness_report", { p_tenant_id: tenant.id });
    return {
      ...tenant,
      capabilities: resolveTenantOperationalCapabilities({
        lifecycleStatus: tenant.lifecycle_status,
        operationalMode: tenant.operational_mode,
      }),
      liveReadiness: readiness ?? { ready: false },
    };
  }));
  const { data: audit } = await supabaseAdmin.from("tenant_operational_mode_audit")
    .select("id,tenant_id,previous_mode,new_mode,actor_user_id,reason,readiness_snapshot,changed_at")
    .order("changed_at", { ascending: false }).limit(100);
  return NextResponse.json({ ok: true, tenants: rows, audit: audit ?? [] });
}

export async function PATCH(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if (!auth.ok) return error(auth.status, auth.error);
  const body = await req.json().catch(() => null);
  const tenantId = String(body?.tenantId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || reason.length < 10 || reason.length > 500) {
    return error(400, "Tenant o motivo inválido");
  }
  if (body?.action === "archive") {
    if (body?.confirmed !== true) return error(409, "El archivado requiere confirmación explícita");
    const result = await supabaseAdmin.rpc("archive_tenant_for_offboarding", {
      p_tenant_id: tenantId, p_actor_id: auth.userId, p_reason: reason,
    });
    if (result.error) return error(409, "No se pudo archivar el tenant");
    return NextResponse.json({ ok: true, result: result.data });
  }
  const operationalMode = String(body?.operationalMode ?? "");
  if (!["unclassified", "demo", "live", "internal"].includes(operationalMode)) {
    return error(400, "Modo operativo inválido");
  }
  if (operationalMode === "live" && body?.confirmed !== true) {
    return error(409, "Cambiar a live requiere confirmar el checklist completo");
  }
  const result = await supabaseAdmin.rpc("set_tenant_operational_mode", {
    p_tenant_id: tenantId,
    p_new_mode: operationalMode,
    p_actor_id: auth.userId,
    p_reason: reason,
  });
  if (result.error) return error(409, result.error.message === "LIVE_TENANT_CHECKLIST_INCOMPLETE"
    ? "El checklist live está incompleto" : "No se pudo cambiar la clasificación");
  return NextResponse.json({ ok: true, result: result.data });
}
