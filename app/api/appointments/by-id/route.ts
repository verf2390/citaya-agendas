import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from("appointments")
      .select(`
        id,
        start_at,
        end_at,
        customer_name,
        customer_phone,
        customer_email,
        professional_id,
        tenant_id,
        service_name,
        description,
        manage_token,
        tenants (
          id,
          name,
          slug,
          base_url,
          admin_email,
          address,
          city,
          phone_display,
          logo_url,
          show_address_after_booking,
          show_phone_after_booking
        ),
        professionals (
          id,
          name,
          title,
          avatar_url,
          code
        )
      `)
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Cita no encontrada" },
        { status: 404 }
      );
    }

    // Supabase puede devolver join como objeto o array
    const profAny = (data as any)?.professionals ?? null;
    const profObj = Array.isArray(profAny)
      ? (profAny.length ? profAny[0] : null)
      : profAny;

    const professional_name =
      (profObj?.name && String(profObj.name).trim()) ||
      (profObj?.title && String(profObj.title).trim()) ||
      null;

    const tenant = (data as any)?.tenants ?? null;

    const appointment = {
      ...(data as any),
      professional_name,
      // (opcional) también dejo el objeto para frontend/email si lo quieres
      professional: profObj ?? null,
    };

    return NextResponse.json({
      ok: true,
      debug: "BY_ID_WITH_DESCRIPTION_AND_PROFESSIONAL",
      appointment,
      tenant,
    });
  } catch (e: any) {
    // Evita que el front reviente con "client-side exception" por un error inesperado
    return NextResponse.json(
      { error: e?.message ?? "Error inesperado en by-id" },
      { status: 500 }
    );
  }
}
