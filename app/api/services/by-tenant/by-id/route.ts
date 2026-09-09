import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveTenantOperationalCapabilities } from "@/lib/tenant/operational-mode.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function notFound() {
  return json({ ok: false, error: "Service not found" }, 404);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") ?? "").trim();
    const tenantSlug = (searchParams.get("tenant") ?? "").trim().toLowerCase();

    if (!UUID.test(id) || !TENANT_SLUG.test(tenantSlug)) {
      return json({ ok: false, error: "Missing or invalid required params: id, tenant" }, 400);
    }

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .select("id,lifecycle_status,operational_mode")
      .eq("slug", tenantSlug)
      .eq("lifecycle_status", "active")
      .maybeSingle();

    if (tenantError) return json({ ok: false, error: "Error interno" }, 500);
    if (!tenant) return notFound();

    const operational = resolveTenantOperationalCapabilities({
      lifecycleStatus: tenant.lifecycle_status,
      operationalMode: tenant.operational_mode,
    });
    if (!operational.createAppointment && !operational.demoSimulation) {
      return notFound();
    }

    let serviceQuery = supabaseAdmin
      .from("services")
      .select("id,name,duration_min,is_active,price,currency")
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .eq("is_active", true);
    if (!operational.demoSimulation) {
      serviceQuery = serviceQuery.eq("payment_configuration_complete", true);
    }
    const { data, error } = await serviceQuery.maybeSingle();

    if (error) {
      return json({ ok: false, error: "Error interno" }, 500);
    }

    if (!data) return notFound();

    const service = {
      id: data.id,
      name: data.name,
      duration_minutes: data.duration_min ?? null,
      price: data.price ?? null,
      currency: data.currency ?? null,
      is_active: data.is_active === true,
    };

    return json({ ok: true, service }, 200);
  } catch {
    return json({ ok: false, error: "Error interno" }, 500);
  }
}
