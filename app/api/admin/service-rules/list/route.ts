import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

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

    const { data, error } = await supabaseServer
      .from("service_availability_rules")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("tenant_id", tenantId)
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
