import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const token = String(url.searchParams.get("token") ?? "").trim();

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
        payment_provider,
        payment_status,
        payment_reference,
        payment_url,
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
          show_phone_after_booking,
          tenant_payment_settings (
            bank_name,
            bank_account_type,
            bank_account_number,
            bank_account_holder,
            bank_rut,
            bank_email
          )
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

    const row = data as Record<string, unknown> & {
      manage_token?: string | null;
      professionals?: unknown;
      tenants?: unknown;
    };

    if (!token || !row.manage_token || row.manage_token !== token) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Supabase puede devolver join como objeto o array
    const profAny = row.professionals ?? null;
    const profObj = Array.isArray(profAny)
      ? (profAny.length ? profAny[0] : null)
      : profAny;
    const professional = profObj as { name?: unknown; title?: unknown } | null;

    const professional_name =
      (professional?.name && String(professional.name).trim()) ||
      (professional?.title && String(professional.title).trim()) ||
      null;

    const tenant = row.tenants ?? null;

    const safeAppointmentData = { ...row };
    delete safeAppointmentData.manage_token;
    const appointment = {
      ...safeAppointmentData,
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
