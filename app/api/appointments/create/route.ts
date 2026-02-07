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

/**
 * ✅ Para textos "1 línea" (service_name, etc)
 */
function cleanTextOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " "); // aplana espacios
  return t ? t : null;
}

/**
 * ✅ Mantiene saltos de línea (para description)
 * - CRLF -> LF
 * - trim general
 * - conserva line breaks para UI y email
 */
function cleanMultilineOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.replace(/\r\n/g, "\n");
  const lines = raw.split("\n").map((l) => l.trimEnd());
  const joined = lines.join("\n").trim();
  return joined ? joined : null;
}

export async function POST(req: Request) {
  try {
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

    // 🔒 usamos service_id para resolver name + description del servicio
    const service_id = typeof body?.service_id === "string" ? body.service_id : "";

    // fallback si el front manda service_name (opcional)
    const service_name_from_body = cleanTextOrNull(body?.service_name);

    // ✅ description puede venir del front (nota del cliente) o se copia desde services.description
    const description_from_body = cleanMultilineOrNull(body?.description);

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

    // ✅ Resolver service_name + description fijo por servicio (snapshot)
    let service_name: string | null = null;
    let description: string | null = description_from_body;

    if (service_id) {
      const { data: svc, error: svcErr } = await supabaseServer
        .from("services")
        .select("name, description")
        .eq("id", service_id)
        .eq("tenant_id", tenant_id)
        .single();

      if (!svcErr && svc) {
        if (svc?.name) service_name = cleanTextOrNull(svc.name);

        // si el front NO mandó description, usamos la del servicio
        if (!description && svc?.description) {
          description = cleanMultilineOrNull(svc.description);
        }
      }
    }

    // fallback final: nombre desde body
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

        service_name,
        description, // ✅ AQUÍ se guarda la description (fija por servicio o nota del cliente)
      })
      .select(
        "id, start_at, end_at, customer_name, customer_phone, customer_email, professional_id, tenant_id, manage_token, service_name, description, currency"
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
