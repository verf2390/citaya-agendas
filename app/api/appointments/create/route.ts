import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function upperOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.toUpperCase() : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const tenant_id = typeof body?.tenant_id === "string" ? body.tenant_id : "";
    const professional_id =
      typeof body?.professional_id === "string" ? body.professional_id : "";

    const customer_name =
      typeof body?.customer_name === "string" ? body.customer_name.trim() : "";
    const customer_phone =
      typeof body?.customer_phone === "string" ? body.customer_phone.trim() : "";
    const customer_email =
      typeof body?.customer_email === "string" ? body.customer_email.trim() : "";

    const start_at = typeof body?.start_at === "string" ? body.start_at : "";
    const end_at = typeof body?.end_at === "string" ? body.end_at : "";

    const status = typeof body?.status === "string" ? body.status : "confirmed";

    // ✅ currency SIEMPRE (fallback CLP). No depende del front.
    const currency = upperOrNull(body?.currency) ?? "CLP";

    if (!tenant_id) {
      return NextResponse.json({ error: "Falta tenant_id" }, { status: 400 });
    }
    if (!professional_id) {
      return NextResponse.json(
        { error: "Falta professional_id" },
        { status: 400 },
      );
    }
    if (!customer_name || customer_name.length < 2) {
      return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
    }
    if (!customer_phone || customer_phone.length < 8) {
      return NextResponse.json({ error: "Celular inválido" }, { status: 400 });
    }
    if (!customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
      return NextResponse.json({ error: "Correo inválido" }, { status: 400 });
    }
    if (!start_at || !end_at) {
      return NextResponse.json(
        { error: "Falta start_at / end_at" },
        { status: 400 },
      );
    }

    // token de gestión (si tu confirmación/cancelación lo usa)
    const manage_token =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // ✅ OJO: no insertamos service_id (porque NO existe en appointments)
    const { data, error } = await supabaseServer
      .from("appointments")
      .insert({
        tenant_id,
        professional_id,
        customer_name,
        customer_phone,
        customer_email,
        start_at,
        end_at,
        status,
        currency,
        manage_token,
      })
      .select(
        "id, start_at, end_at, customer_name, customer_phone, customer_email, professional_id, tenant_id, manage_token",
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "No se pudo crear la cita" },
        { status: 500 },
      );
    }

    // 🔔 n8n — confirmación (NO bloqueante)
    try {
      const baseUrl =
        process.env.N8N_CONFIRM_WEBHOOK_URL ||
        "https://n8n.citaya.online/webhook/citaya-confirmacion";

      const secret =
        process.env.N8N_WEBHOOK_SECRET || "citaya_secret_2026_9a8b7c6d";

      // usamos query secret porque Cloudflare/proxy puede filtrar headers custom
      const url = `${baseUrl}?secret=${encodeURIComponent(secret)}`;

      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointment_id: data.id,
          event: "appointment.created",
        }),
      });
    } catch (e: any) {
      console.error("[appointments/create] n8n confirm failed:", e?.message || e);
    }

    return NextResponse.json({ appointment: data });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Error creando cita" },
      { status: 500 },
    );
  }
}
