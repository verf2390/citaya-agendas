import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenantId");
    const professionalId = url.searchParams.get("professionalId");
    const serviceId = url.searchParams.get("serviceId");

    if (!tenantId || !professionalId || !serviceId) {
      return NextResponse.json(
        { error: "Faltan parámetros: tenantId, professionalId, serviceId" },
        { status: 400 },
      );
    }

    if (!isUuid(tenantId) || !isUuid(professionalId) || !isUuid(serviceId)) {
      return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
    }

    const auth = await requireTenantAdmin(req, { tenantId });
    if (!auth.ok) return auth.response;

    const { data: professional, error: professionalError } = await supabaseAdmin
      .from("professionals")
      .select("id")
      .eq("id", professionalId)
      .eq("tenant_id", auth.tenantId)
      .maybeSingle();

    if (professionalError) throw professionalError;
    if (!professional?.id) {
      return NextResponse.json(
        { error: "professionalId inválido para este tenant" },
        { status: 403 },
      );
    }

    const { data: service, error: serviceError } = await supabaseAdmin
      .from("services")
      .select("id")
      .eq("id", serviceId)
      .eq("tenant_id", auth.tenantId)
      .maybeSingle();

    if (serviceError) throw serviceError;
    if (!service?.id) {
      return NextResponse.json(
        { error: "serviceId inválido para este tenant" },
        { status: 403 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("service_availability_rules")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("tenant_id", auth.tenantId)
      .eq("professional_id", professionalId)
      .eq("service_id", serviceId);

    if (error) throw error;

    return NextResponse.json({ items: data ?? [] });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e?.message ?? "Error listando reglas por servicio" },
      { status: 500 },
    );
  }
}
