import { NextResponse } from "next/server";

import { requirePlatformAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function error(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
  return value === true || value === false;
}

const FEATURE_ERROR_MESSAGES: Record<string, string> = {
  PLATFORM_ADMIN_REQUIRED: "Se requiere acceso de plataforma",
  TENANT_NOT_FOUND: "Tenant no encontrado",
  USE_OFFBOARDING_FOR_ARCHIVED_TENANT: "El tenant archivado debe gestionarse por offboarding",
  FEATURE_CHANGE_REASON_REQUIRED: "Ingresa un motivo de al menos 10 caracteres",
  TAX_DOCUMENT_MODE_INVALID: "Modo tributario inválido",
  CAMPAIGNS_REQUIRE_EXTERNAL_COMMUNICATIONS: "Las campañas requieren comunicaciones externas",
  APPOINTMENT_COMMUNICATIONS_REQUIRE_APPOINTMENTS: "Las comunicaciones de citas requieren agenda activa",
  DTE_FEATURE_TAX_MODE_MISMATCH: "DTE solo puede habilitarse con modo tributario Citaya DTE",
  EXTERNAL_BHE_EVIDENCE_REQUIRED: "La BHE externa requiere una referencia de verificación",
  LIVE_TENANT_FEATURE_CHANGE_NOT_READY: "El cambio dejaría incompleto un tenant que ya está live",
};

function mappedRpcError(message: string) {
  for (const [code, publicMessage] of Object.entries(FEATURE_ERROR_MESSAGES)) {
    if (message.includes(code)) return publicMessage;
  }
  return "No se pudo actualizar la configuración operativa";
}

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if (!auth.ok) return error(auth.status, auth.error);

  const tenantId = new URL(req.url).searchParams.get("tenantId")?.trim() ?? "";
  if (!isUuid(tenantId)) return error(400, "Tenant inválido");

  const [settings, readiness, capabilities, taxDocument] = await Promise.all([
    supabaseAdmin
      .from("tenant_operational_features")
      .select("tenant_id,appointments_enabled,appointment_communications_enabled,external_communications_enabled,campaigns_enabled,payments_enabled,dte_enabled,tax_document_mode,tax_mode_verified_at,tax_mode_evidence_reference,updated_at,updated_by")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin.rpc("tenant_live_readiness_report", { p_tenant_id: tenantId }),
    supabaseAdmin.rpc("resolve_tenant_operational_capabilities", { p_tenant_id: tenantId }),
    supabaseAdmin.rpc("tenant_tax_document_readiness", { p_tenant_id: tenantId }),
  ]);

  if (settings.error || readiness.error || capabilities.error || taxDocument.error) {
    return error(503, "No se pudo cargar la configuración operativa");
  }

  return NextResponse.json({
    ok: true,
    settings: settings.data,
    readiness: readiness.data ?? { ready: false },
    capabilities: capabilities.data ?? { exists: false },
    taxDocument: taxDocument.data ?? { ready: false, mode: "unconfigured" },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if (!auth.ok) return error(auth.status, auth.error);

  const body: unknown = await req.json().catch(() => null);
  if (!isObject(body)) return error(400, "Solicitud inválida");

  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const taxDocumentMode = typeof body.taxDocumentMode === "string"
    ? body.taxDocumentMode.trim()
    : "";
  const taxModeEvidenceReference = typeof body.taxModeEvidenceReference === "string"
    ? body.taxModeEvidenceReference.trim()
    : "";

  if (!isUuid(tenantId) || reason.length < 10 || reason.length > 500) {
    return error(400, "Tenant o motivo inválido");
  }
  if (!["unconfigured", "citaya_dte", "external_bhe"].includes(taxDocumentMode)) {
    return error(400, "Modo tributario inválido");
  }

  const booleanFields = [
    "appointmentsEnabled",
    "appointmentCommunicationsEnabled",
    "externalCommunicationsEnabled",
    "campaignsEnabled",
    "paymentsEnabled",
    "dteEnabled",
  ] as const;
  if (booleanFields.some((field) => !isBoolean(body[field]))) {
    return error(400, "Todas las capacidades deben definirse explícitamente");
  }

  const result = await supabaseAdmin.rpc("set_tenant_operational_features", {
    p_tenant_id: tenantId,
    p_actor_id: auth.userId,
    p_appointments_enabled: body.appointmentsEnabled,
    p_appointment_communications_enabled: body.appointmentCommunicationsEnabled,
    p_external_communications_enabled: body.externalCommunicationsEnabled,
    p_campaigns_enabled: body.campaignsEnabled,
    p_payments_enabled: body.paymentsEnabled,
    p_dte_enabled: body.dteEnabled,
    p_tax_document_mode: taxDocumentMode,
    p_tax_mode_evidence_reference: taxModeEvidenceReference || null,
    p_reason: reason,
  });

  if (result.error) return error(409, mappedRpcError(result.error.message));
  return NextResponse.json({ ok: true, result: result.data }, { headers: { "Cache-Control": "no-store" } });
}
