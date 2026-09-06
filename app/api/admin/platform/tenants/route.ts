import { NextResponse } from "next/server";

import { requirePlatformAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveTenantOperationalCapabilities } from "@/lib/tenant/operational-mode.mjs";

function error(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type ProvisioningError = {
  status: number;
  message: string;
};

const PROVISIONING_ERRORS: Record<string, ProvisioningError> = {
  TENANT_SLUG_INVALID: { status: 400, message: "Slug inválido" },
  TENANT_SLUG_RESERVED: { status: 400, message: "Slug reservado" },
  TENANT_NAME_REQUIRED: { status: 400, message: "Nombre requerido" },
  PROVISIONING_REQUEST_ID_REQUIRED: {
    status: 400,
    message: "requestId requerido",
  },
  PROVISIONING_OWNER_REQUIRED: {
    status: 400,
    message: "ownerUserId requerido",
  },
  PLATFORM_SUPER_ADMIN_REQUIRED: {
    status: 403,
    message: "Platform super admin requerido",
  },
  OWNER_USER_NOT_FOUND: { status: 404, message: "Owner no encontrado" },
  OWNER_EMAIL_REQUIRED: {
    status: 409,
    message: "El owner no tiene email",
  },
  TENANT_SLUG_ALREADY_EXISTS: {
    status: 409,
    message: "El slug ya está registrado",
  },
  PROVISIONING_REQUEST_PAYLOAD_MISMATCH: {
    status: 409,
    message: "El requestId ya fue usado con otros datos",
  },
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function provisioningError(message: unknown): ProvisioningError | null {
  if (typeof message !== "string") return null;
  for (const [code, mapped] of Object.entries(PROVISIONING_ERRORS)) {
    if (message.includes(code)) return mapped;
  }
  return null;
}

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if (!auth.ok) return error(auth.status, auth.error);
  const { data: tenants, error: tenantError } = await supabaseAdmin.from("tenants")
    .select("id,name,slug,lifecycle_status,operational_mode,operational_mode_changed_at,operational_mode_changed_by,operational_mode_change_reason")
    .order("created_at", { ascending: true });
  if (tenantError) return error(503, "No se pudo cargar la clasificación");
  const rows = await Promise.all((tenants ?? []).map(async (tenant) => {
    const [{ data: readiness }, { data: selfIssuerAuthority }] = await Promise.all([
      supabaseAdmin.rpc("tenant_live_readiness_report", { p_tenant_id: tenant.id }),
      supabaseAdmin.rpc("tenant_self_issuer_authority_report", { p_tenant_id: tenant.id }),
    ]);
    return {
      ...tenant,
      capabilities: resolveTenantOperationalCapabilities({
        lifecycleStatus: tenant.lifecycle_status,
        operationalMode: tenant.operational_mode,
      }),
      liveReadiness: readiness ?? { ready: false },
      selfIssuerAuthority: selfIssuerAuthority ?? { status: "none", valid: false },
    };
  }));
  const { data: audit } = await supabaseAdmin.from("tenant_operational_mode_audit")
    .select("id,tenant_id,previous_mode,new_mode,actor_user_id,reason,readiness_snapshot,changed_at")
    .order("changed_at", { ascending: false }).limit(100);
  return NextResponse.json({ ok: true, tenants: rows, audit: audit ?? [] });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if (!auth.ok) return error(auth.status, auth.error);

  const body: unknown = await req.json().catch(() => null);
  if (!isJsonObject(body)) return error(400, "Solicitud inválida");

  const requestId = typeof body.requestId === "string"
    ? body.requestId.trim()
    : "";
  const ownerUserId = typeof body.ownerUserId === "string"
    ? body.ownerUserId.trim()
    : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!isUuid(requestId) || !isUuid(ownerUserId) || !slug || !name) {
    return error(400, "Solicitud inválida");
  }

  const optionalFields = [
    "contactEmail",
    "phoneDisplay",
    "whatsapp",
    "address",
    "city",
  ] as const;
  if (optionalFields.some((field) =>
    body[field] !== undefined &&
    body[field] !== null &&
    typeof body[field] !== "string"
  )) {
    return error(400, "Solicitud inválida");
  }
  const optional = (field: typeof optionalFields[number]) =>
    typeof body[field] === "string" ? body[field].trim() : null;

  const result = await supabaseAdmin.rpc("provision_tenant", {
    p_request_id: requestId,
    p_actor_user_id: auth.userId,
    p_owner_user_id: ownerUserId,
    p_slug: slug,
    p_name: name,
    p_contact_email: optional("contactEmail"),
    p_phone_display: optional("phoneDisplay"),
    p_whatsapp: optional("whatsapp"),
    p_address: optional("address"),
    p_city: optional("city"),
  });

  if (result.error) {
    const mapped = provisioningError(result.error.message);
    return mapped
      ? error(mapped.status, mapped.message)
      : error(503, "No se pudo crear el tenant");
  }

  const data: unknown = result.data;
  if (
    !isJsonObject(data) ||
    typeof data.tenantId !== "string" ||
    !isUuid(data.tenantId) ||
    typeof data.requestId !== "string" ||
    !isUuid(data.requestId) ||
    data.requestId.toLowerCase() !== requestId.toLowerCase() ||
    typeof data.created !== "boolean"
  ) {
    return error(503, "No se pudo crear el tenant");
  }

  return NextResponse.json({
    ok: true,
    tenantId: data.tenantId,
    requestId: data.requestId,
    created: data.created,
  }, { status: data.created ? 201 : 200 });
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
  if (body?.action === "registerSelfIssuer" || body?.action === "revokeSelfIssuer") {
    if (body?.confirmed !== true) return error(409, "La autoridad de emisor propio requiere confirmación explícita");
    const administrativeReference = String(body?.administrativeReference ?? "").trim();
    if (administrativeReference.length < 3 || administrativeReference.length > 300) {
      return error(400, "Referencia administrativa inválida");
    }
    if (body.action === "registerSelfIssuer") {
      const { data: tax, error: taxError } = await supabaseAdmin
        .from("dte_production_tenant_settings").select("issuer_rut")
        .eq("tenant_id", tenantId).maybeSingle();
      if (taxError || !tax?.issuer_rut) return error(409, "Identidad tributaria incompleta");
      const result = await supabaseAdmin.rpc("register_tenant_self_issuer_authority", {
        p_tenant_id: tenantId,
        p_actor_user_id: auth.userId,
        p_issuer_rut_snapshot: tax.issuer_rut,
        p_reason: reason,
        p_administrative_reference: administrativeReference,
      });
      if (result.error) return error(409, "No se pudo registrar la autoridad de emisor propio");
      return NextResponse.json({ ok: true, result: result.data });
    }
    const result = await supabaseAdmin.rpc("revoke_tenant_self_issuer_authority", {
      p_tenant_id: tenantId,
      p_actor_user_id: auth.userId,
      p_reason: reason,
      p_administrative_reference: administrativeReference,
    });
    if (result.error) return error(409, "No se pudo revocar la autoridad de emisor propio");
    return NextResponse.json({ ok: true, result: result.data });
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
