import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { generateManageToken } from "@/app/lib/manageToken";

/**
 * Dispara n8n server-side para enviar correo de confirmación.
 * - No debe romper la reserva si n8n falla.
 * - Se protege con header secreto.
 */
async function triggerN8nConfirmation(appointmentId: string) {
  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;

  if (!url || !secret) {
    console.warn("[n8n] Falta N8N_WEBHOOK_URL o N8N_WEBHOOK_SECRET");
    return;
  }

  // Timeout para no colgar el POST de reserva
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-citaya-secret": secret,
      },
      body: JSON.stringify({ appointment_id: appointmentId }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[n8n] Webhook respondió error:", res.status, text);
    }
  } catch (err) {
    console.error("[n8n] Error llamando webhook:", err);
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      tenant_id,
      professional_id,
      customer_name,
      customer_phone,
      customer_email, // ✅ lo sacamos del body una vez
      start_at,
      end_at,
    } = body;

    if (!tenant_id || !professional_id || !customer_name || !start_at || !end_at) {
      return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
    }

    // (Recomendado) valida email mínimo (MVP)
    if (!customer_email || typeof customer_email !== "string" || !customer_email.includes("@")) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }

    // ✅ Evitar choque horario (overlap)
    // Se cruza si: start < existing_end AND end > existing_start
    const { data: conflicts, error: conflictError } = await supabaseServer
      .from("appointments")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("professional_id", professional_id)
      .lt("start_at", end_at)
      .gt("end_at", start_at)
      .limit(1);

    if (conflictError) {
      return NextResponse.json({ error: conflictError.message }, { status: 500 });
    }

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json(
        { error: "Ese horario ya está reservado para ese profesional." },
        { status: 409 }
      );
    }

    // ✅ Insert de la cita
    const manage_token = generateManageToken();
    
    const { data, error } = await supabaseServer
      .from("appointments")

      
      .insert([
        {
          tenant_id,
          professional_id,
          customer_name,
          customer_phone: customer_phone ?? null,
          customer_email,
          start_at,
          end_at,
          status: "confirmed",
          manage_token,
          manage_token_created_at: new Date().toISOString(),

          // ✅ anti-duplicado: por defecto aún NO enviada
          confirmation_sent_at: null,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ✅ Disparar n8n server-side SIN bloquear al usuario
    // (si quieres 100% fire-and-forget, igual lo hacemos "await" porque es 5s máx con timeout)
    // Lo importante: si falla, NO rompe.
    triggerN8nConfirmation(data.id);

    return NextResponse.json({ ok: true, appointment: data }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Error inesperado" },
      { status: 500 }
    );
  }
}
