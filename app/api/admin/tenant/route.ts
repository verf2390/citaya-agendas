export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type TenantUpdatePayload = {
  tenantSlug?: string;
  name?: unknown;
  phone_display?: unknown;
  whatsapp?: unknown;
  contact_email?: unknown;
  address?: unknown;
  city?: unknown;
  description?: unknown;
  logo_url?: unknown;
};

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

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

function getTenantSlug(req: Request, body: TenantUpdatePayload) {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  const fromHost = getTenantSlugFromHostname(host);
  if (fromHost) return fromHost;

  return String(body.tenantSlug ?? "").trim();
}

export async function PATCH(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Unauthorized", 401);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Unauthorized", 401);

    const body = (await req.json().catch(() => null)) as TenantUpdatePayload | null;
    if (!body || typeof body !== "object") return jsonError("JSON inválido");

    const tenantSlug = getTenantSlug(req, body);
    if (!tenantSlug) return jsonError("No se pudo detectar el tenant actual.");

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

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .select("id, slug")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (tenantError || !tenant?.id) {
      return jsonError("No se pudo validar el negocio actual.", 404);
    }

    const { error: updateError } = await supabaseAdmin
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
      .eq("id", tenant.id);

    if (updateError) {
      console.error("[api/admin/tenant] update error:", updateError);
      return jsonError(updateError.message, 500);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[api/admin/tenant] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "No se pudo guardar la configuración" },
      { status: 500 },
    );
  }
}
