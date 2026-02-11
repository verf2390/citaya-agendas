import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { parseJson } from "@/lib/api/parse";
import { AppointmentCreateSchema } from "@/lib/api/schemas";

export async function POST(req: Request) {
  try {
    const parsed = await parseJson(req, AppointmentCreateSchema);
    if (!parsed.ok) return parsed.res;

    const {
      tenantId,
      professionalId,
      startAt,
      endAt,
      customerName,
      customerPhone,
      customerEmail,
      customerId,
      serviceId,
      notes,
      currency,
      status,
    } = parsed.data;

    const sb = supabaseServer;

    /* =====================================================
       SNAPSHOT SERVICIO
    ===================================================== */
    let service_name: string | null = null;
    let description: string | null = null;

    if (serviceId) {
      const { data: svc, error } = await sb
        .from("services")
        .select("name, description")
        .eq("tenant_id", tenantId)
        .eq("id", serviceId)
        .maybeSingle();

      if (error) throw error;

      service_name = svc?.name ?? null;
      description = svc?.description ?? null;
    }

    /* =====================================================
       INSERT DB
    ===================================================== */
    const payload = {
      tenant_id: tenantId,
      professional_id: professionalId,
      start_at: startAt,
      end_at: endAt,

      customer_name: customerName,
      customer_phone: customerPhone ?? null,
      customer_email: customerEmail ?? null,
      customer_id: customerId ?? null,

      service_name,
      description,

      notes: notes ?? null,
      currency: currency ?? "CLP",
      status: status ?? "confirmed",
      source: "admin",
    };

    const { data, error } = await sb
      .from("appointments")
      .insert(payload)
      .select("id, manage_token")
      .single();

    if (error) throw error;

    /* =====================================================
       🔥 WEBHOOK N8N (CON SECRET + LOGS)
    ===================================================== */
    const webhookBase = process.env.N8N_CONFIRMATION_WEBHOOK_URL;
    const secret = process.env.CITAYA_SECRET;

    if (!webhookBase) {
      console.warn(
        "[appointments/create] N8N_CONFIRMATION_WEBHOOK_URL no seteada",
      );
    } else {
      try {
        // 👉 agregamos ?secret=XXXX automáticamente
        const url = new URL(webhookBase);
        if (secret) url.searchParams.set("secret", secret);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            event: "appointment.created",
            appointmentId: data.id,

            tenantId,
            professionalId,
            startAt,
            endAt,

            customerName,
            customerPhone: customerPhone ?? null,
            customerEmail: customerEmail ?? null,
            customerId: customerId ?? null,

            serviceId: serviceId ?? null,
            service_name,
            description,

            notes: notes ?? null,
            currency: currency ?? "CLP",
            status: status ?? "confirmed",

            source: "citaya-api",
            createdAt: new Date().toISOString(),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        console.log(
          "[appointments/create] n8n webhook status:",
          res.status,
        );
      } catch (err: any) {
        console.error(
          "[appointments/create] n8n webhook error:",
          err?.message || err,
        );
      }
    }

    /* =====================================================
       RESPONSE
    ===================================================== */
    return NextResponse.json({
      ok: true,
      appointmentId: data.id,
      manageToken: data.manage_token,
    });
  } catch (e: any) {
    console.error("[appointments/create] error:", e?.message || e);

    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error inesperado" },
      { status: 500 },
    );
  }
}
