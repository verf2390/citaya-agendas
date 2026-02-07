// app/api/appointments/create/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function upperOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.toUpperCase() : null;
}

function stringOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function cleanTextOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " "); // evita \n y dobles espacios
  return t ? t : null;
}

export async function POST(req: Request) {
  try {
    // ✅ Leemos el body UNA sola vez
    const body = await req.json();

    const tenant_id = stringOrEmpty(body?.tenant_id);
    const professional_id = stringOrEmpty(body?.professional_id);

    const customer_name = stringOrEmpty(body?.customer_name).trim();
    const customer_phone = stringOrEmpty(body?.customer_phone).trim();
    const customer_email = stringOrEmpty(body?.customer_email).trim();

    const start_at = stringOrEmpty(body?.start_at);
    const end_at = stringOrEmpty(body?.end_at);

    const status = stringOrEmpty(body?.status) || "confirmed";
    const currency = upperOrNull(body?.currency) ?? "CLP";

    // 🔒 service_id NO se guarda en appointments (no existe la columna),
    // pero lo usamos para obtener el nombre correcto desde services.
    const service_id = typeof body?.service_id === "string" ? body.service_id : "";

    // fallback si quieres permitir que el front lo mande (opcional)
    const service_name_from_body = cleanTextOrNull(body?.service_name);

    // Validaciones mínimas
    if (!tenant_id) {
      return NextResponse.json({ error: "Falta tenant_id" }, { status: 400 });
    }
    if (!professional_id) {
      return NextResponse.json({ error: "Falta professional_id" }, { status: 400 });
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
      return NextResponse.json({ error: "Falta start_at / end_at" }, { status: 400 });
    }

    // ✅ Resolver service_name de forma confiable (multi-tenant safe)
    let service_name: string | null = null;

    if (service_id) {
      const { data: svc, error: svcErr } = await supabaseServer
        .from("services")
        .select("name")
        .eq("id", service_id)
        .eq("tenant_id", tenant_id) // 🔒 evita mezclar tenants
        .single();

      if (!svcErr && svc?.name) {
        service_name = cleanTextOrNull(svc.name);
      }
    }

    // fallback: si no vino service_id o no se encontró, usa lo que manda el front
    if (!service_name) {
      service_name = service_name_from_body;
    }

    // token de gestión
    const manage_token =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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

        // ✅ snapshot definitivo del servicio
        service_name,
      })
      .select(
        "id, start_at, end_at, customer_name, customer_phone, customer_email, professional_id, tenant_id, manage_token, service_name, currency"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "No se pudo crear la cita" },
        { status: 500 }
      );
    }

    // 🔔 n8n — confirmación (NO bloqueante)
    try {
      const baseUrl =
        process.env.N8N_CONFIRM_WEBHOOK_URL ||
        "https://n8n.citaya.online/webhook/citaya-confirmacion";

      const secret =
        process.env.N8N_WEBHOOK_SECRET || "citaya_secret_2026_9a8b7c6d";

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
      { status: 500 }
    );
  }
}
