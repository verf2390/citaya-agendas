export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const [customers, appointments, payments, taxProfiles, issuer, services] = await Promise.all([
    supabaseAdmin.from("customers")
      .select("id,full_name,email,phone,rut_normalized")
      .eq("tenant_id", auth.tenantId).order("full_name").limit(500),
    supabaseAdmin.from("appointments")
      .select("id,customer_id,service_name,start_at,payment_status,payment_paid_amount,invoice_requested,tax_treatment_snapshot")
      .eq("tenant_id", auth.tenantId).order("start_at", { ascending: false }).limit(200),
    supabaseAdmin.from("payment_intents")
      .select("id,appointment_id,amount,currency,status,provider,processed_at")
      .eq("tenant_id", auth.tenantId).eq("status", "succeeded")
      .order("processed_at", { ascending: false }).limit(200),
    supabaseAdmin.from("customer_tax_profiles")
      .select("customer_id,rut_normalized,legal_name,business_activity,tax_address,tax_commune,tax_city,tax_email")
      .eq("tenant_id", auth.tenantId).limit(500),
    supabaseAdmin.from("dte_production_tenant_settings")
      .select("issuer_rut,issuer_legal_name,issuer_activity,issuer_address,issuer_commune,issuer_city")
      .eq("tenant_id", auth.tenantId).maybeSingle(),
    supabaseAdmin.from("services")
      .select("id,name,description,price,currency,tax_treatment,is_active")
      .eq("tenant_id", auth.tenantId)
      .eq("is_active", true)
      .order("name").limit(500),
  ]);
  if (customers.error || appointments.error || payments.error || taxProfiles.error || issuer.error || services.error) {
    return NextResponse.json({ ok: false, error: "No se pudieron cargar las referencias" }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    tenantId: auth.tenantId,
    customers: (customers.data ?? []).map((customer) => ({
      ...customer,
      tax_profile: (taxProfiles.data ?? []).find((profile) => profile.customer_id === customer.id) ?? null,
    })),
    issuer: issuer.data ?? null,
    appointments: appointments.data ?? [],
    payments: payments.data ?? [],
    services: (services.data ?? []).map((service) => ({
      ...service,
      priceIncludesVat: service.tax_treatment !== "exempt",
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
