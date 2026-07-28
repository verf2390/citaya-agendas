import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { normalizeRequiredCustomerRut, normalizeTaxProfile } from "@/lib/dte/cutover";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function notFound() {
  return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
}

async function authorize(req: Request, customerId: string) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok || !isUuid(customerId)) return null;
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id,rut_normalized")
    .eq("tenant_id", auth.tenantId)
    .eq("id", customerId)
    .maybeSingle();
  return customer ? { auth, customer } : null;
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorize(req, id);
  if (!access) return notFound();
  const { data, error } = await supabaseAdmin
    .from("customer_tax_profiles")
    .select("rut_normalized,legal_name,business_activity,tax_address,tax_commune,tax_city,tax_email,updated_at")
    .eq("tenant_id", access.auth.tenantId)
    .eq("customer_id", id)
    .maybeSingle();
  if (error) return notFound();
  return NextResponse.json({ ok: true, customerRut: access.customer.rut_normalized, profile: data });
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorize(req, id);
  if (!access) return notFound();
  const body = await req.json().catch(() => null);
  try {
    const customerRut = normalizeRequiredCustomerRut(body?.customerRut);
    const profile = body?.profile ? normalizeTaxProfile(body.profile) : null;
    const customerUpdate = await supabaseAdmin.from("customers")
      .update({ rut_normalized: customerRut })
      .eq("tenant_id", access.auth.tenantId).eq("id", id);
    if (customerUpdate.error) return notFound();
    if (profile) {
      const result = await supabaseAdmin.from("customer_tax_profiles").upsert({
        tenant_id: access.auth.tenantId,
        customer_id: id,
        rut_normalized: profile.rut,
        legal_name: profile.legalName,
        business_activity: profile.businessActivity,
        tax_address: profile.address,
        tax_commune: profile.commune,
        tax_city: profile.city,
        tax_email: profile.taxEmail,
        updated_by: access.auth.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,customer_id" });
      if (result.error) return notFound();
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Datos tributarios inválidos" }, { status: 400 });
  }
}
