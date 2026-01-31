import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import crypto from "crypto";
import { getTenantSlugFromHostname } from "@/lib/tenant";

/**
 * Token URL-safe para gestionar la cita desde link público
 */
function makeManageToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function getHostnameFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "";
  return host.split(",")[0].trim().split(":")[0];
}

/**
 * Construye base URL pública priorizando el host real (subdominio).
 * Fallback: PUBLIC_BASE_URL env o app.citaya.online
 */
function getPublicBaseUrl(req: Request) {
  const hostname = getHostnameFromReq(req);

  // Si viene subdominio tipo fajaspaola.citaya.online => usamos ese host
  if (hostname && hostname.includes(".")) {
    return `https://${hostname}`;
  }

  // Fallback configurable
  return process.env.PUBLIC_BASE_URL || "https://app.citaya.online";
}

/**
 * Dispara n8n server-side para enviar correo de confirmación.
 * - No debe romper la reserva si n8n falla.
 * - Se protege con header secreto.
 * - Enviamos manage_token + public_base_url para link real.
 */
async function triggerN8nConfirmation(payload: {
  appointment_id: string;
  manage_token: string;
  public_base_url: string;
}) {
  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;

  if (!url || !secret) {
    console.warn("[n8n] Falta N8N_WEBHOOK_URL o N8N_WEBHOOK_SECRET");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-citaya-secret": secret,
      },
      body: JSON.stringify(payload),
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
      customer_email,
      start_at,
      end_at,
    } = body ?? {};

    if (!tenant_id || !professional_id || !customer_name || !start_at || !end_at) {
      return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
    }

    // Email mínimo
    if (
      !customer_email ||
      typeof customer_email !== "string" ||
      !customer_email.includes("@")
    ) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }

    // Normalizar fechas y validar rango
    const startISO = new Date(start_at).toISOString();
    const endISO = new Date(end_at).toISOString();

    if (!(new Date(endISO).getTime() > new Date(startISO).getTime())) {
      return NextResponse.json({ error: "Rango horario inválido" }, { status: 400 });
    }

    // ✅ Multi-tenant: validar que el profesional pertenece al tenant (anti-inyección)
    {
      const { data: prof, error: profErr } = await supabaseServer
        .from("professionals")
        .select("id")
        .eq("id", professional_id)
        .eq("tenant_id", tenant_id)
        .maybeSingle();

      if (profErr) {
        return NextResponse.json({ error: profErr.message }, { status: 500 });
      }
      if (!prof?.id) {
        return NextResponse.json({ error: "Profesional inválido para este tenant" }, { status: 403 });
      }
    }

    // ✅ Evitar choque horario (overlap) SOLO contra citas no canceladas
    // Se cruza si: start < existing_end AND end > existing_start
    const { data: conflicts, error: conflictError } = await supabaseServer
      .from("appointments")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("professional_id", professional_id)
      .neq("status", "canceled")
      .lt("start_at", endISO)
      .gt("end_at", startISO)
      .limit(1);

    if (conflictError) {
      return NextResponse.json({ error: conflictError.message }, { status: 500 });
    }

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json(
        { error: "Ese horario ya está reservado para ese profesional." },
        { status: 409 },
      );
    }

    // ✅ Generar token de gestión
    const manage_token = makeManageToken();

    // ✅ Insert de la cita (incluye manage_token)
    const { data, error } = await supabaseServer
      .from("appointments")
      .insert([
        {
          tenant_id,
          professional_id,
          customer_name,
          customer_phone: customer_phone ?? null,
          customer_email: String(customer_email).trim().toLowerCase(),
          start_at: startISO,
          end_at: endISO,
          status: "confirmed",

          // anti-duplicado: por defecto aún NO enviada
          confirmation_sent_at: null,

          // token de gestión
          manage_token,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ✅ Disparar n8n SIN bloquear al usuario (máx 5s)
    const public_base_url = getPublicBaseUrl(req);

    await triggerN8nConfirmation({
      appointment_id: data.id,
      manage_token,
      public_base_url,
    });

    return NextResponse.json({ ok: true, appointment: data }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error inesperado" }, { status: 500 });
  }
}
