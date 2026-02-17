import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normalizeIso(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return s;

  // Si viene "YYYY-MM-DD HH:mm:ss+00" => "YYYY-MM-DDTHH:mm:ss+00"
  // Esto evita interpretaciones raras en new Date()
  if (s.includes(" ")) return s.replace(" ", "T");

  return s;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = String(searchParams.get("token") ?? "").trim();

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing token" },
        { status: 400 },
      );
    }

    // Traemos la cita + join a professionals para obtener el nombre
    // OJO: asume FK appointments.professional_id -> professionals.id
    // y que en professionals existe columna "name".
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .select(
        `
        id,
        tenant_id,
        professional_id,
        service_id,
        service_name,
        customer_name,
        customer_phone,
        customer_email,
        start_at,
        end_at,
        status,
        professional:professionals (
          id,
          name
        )
      `,
      )
      .eq("manage_token", token)
      .maybeSingle();

    if (error) {
      console.error("by-token DB error:", error);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Invalid token" },
        { status: 404 },
      );
    }

    // ✅ Normalizar timestamps para asegurar ISO estable hacia el frontend
    const appointment = {
      id: data.id,
      tenant_id: data.tenant_id,
      professional_id: data.professional_id,

      // ✅ CLAVE: exponer service_id para que /availability aplique reglas por servicio
      service_id: (data as any).service_id ?? null,

      // ✅ Mantener service_name real (si existe)
      service_name: (data as any).service_name ?? null,

      customer_name: data.customer_name,
      customer_phone: data.customer_phone,
      customer_email: data.customer_email,
      status: data.status,
      start_at: normalizeIso((data as any).start_at),
      end_at: normalizeIso((data as any).end_at),

      // ✅ Nombre del profesional (si existe)
      professional_name: (data as any)?.professional?.name ?? null,
    };

    return NextResponse.json({ ok: true, appointment });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Unhandled error", details: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
