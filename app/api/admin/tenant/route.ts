export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";

type TenantUpdatePayload = {
  name?: unknown;
  phone_display?: unknown;
  whatsapp?: unknown;
  contact_email?: unknown;
  address?: unknown;
  city?: unknown;
  description?: unknown;
  logo_url?: unknown;
};

const TENANT_PUBLIC_CONFIG_SELECT =
  "id, slug, name, phone_display, whatsapp, contact_email, address, city, description, logo_url";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function optionalText(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function countDigits(value: string) {
  return value.replace(/\D/g, "").length;
}

export async function GET(req: Request) {
  try {
    const access = await requireHostTenantAdmin(req);
    if (!access.ok) return jsonError(access.status === 401 ? "Unauthorized" : "Forbidden", access.status);

    const { data: tenant, error } = await supabaseAdmin
      .from("tenants")
      .select(TENANT_PUBLIC_CONFIG_SELECT)
      .eq("id", access.tenantId)
      .maybeSingle();

    if (error) return jsonError("Error interno", 500);
    if (!tenant?.id) return jsonError("No se pudo cargar el negocio actual.", 404);

    return NextResponse.json({ ok: true, tenant });
  } catch (e: any) {
    console.error("[api/admin/tenant] get error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await requireHostTenantAdmin(req);
    if (!access.ok) return jsonError(access.status === 401 ? "Unauthorized" : "Forbidden", access.status);

    const body = (await req.json().catch(() => null)) as TenantUpdatePayload | null;
    if (!body || typeof body !== "object") return jsonError("JSON inválido");

    const name = optionalText(body.name);
    const phoneDisplay = optionalText(body.phone_display);
    const whatsapp = optionalText(body.whatsapp);
    const contactEmail = optionalText(body.contact_email);

    if (!name) return jsonError("El nombre del negocio es obligatorio.");
    if (whatsapp && countDigits(whatsapp) < 8) {
      return jsonError("Ingresa un WhatsApp con al menos 8 dígitos.");
    }
    if (contactEmail && !isEmail(contactEmail)) {
      return jsonError("Ingresa un email válido para el contacto del negocio.");
    }

    const { data: updatedTenant, error: updateError } = await supabaseAdmin
      .from("tenants")
      .update({
        name,
        phone_display: phoneDisplay,
        whatsapp,
        contact_email: contactEmail,
        address: optionalText(body.address),
        city: optionalText(body.city),
        description: optionalText(body.description),
        logo_url: optionalText(body.logo_url),
      })
      .eq("id", access.tenantId)
      .select(TENANT_PUBLIC_CONFIG_SELECT)
      .single();

    if (updateError) {
      console.error("[api/admin/tenant] update error:", updateError);
      return jsonError("Error interno", 500);
    }

    return NextResponse.json({ ok: true, tenant: updatedTenant });
  } catch (e: any) {
    console.error("[api/admin/tenant] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 },
    );
  }
}
