import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { parseJson } from "@/lib/api/parse";
import { AppointmentCreateSchema } from "@/lib/api/schemas";

/* =====================================================
   CUSTOMERS: UPSERT SERVER-SIDE (para reservar público)
===================================================== */

function cleanTextOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t : null;
}

function cleanPhoneOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const norm = t.replace(/[^\d+]/g, "");
  return norm ? norm : null;
}

function cleanEmailOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t ? t : null;
}

async function resolveCustomerId(args: {
  sb: typeof supabaseServer;
  tenantId: string;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
}) {
  const { sb, tenantId } = args;

  if (args.customerId) return args.customerId;

  const full_name = cleanTextOrNull(args.customerName);
  const phone = cleanPhoneOrNull(args.customerPhone);
  const email = cleanEmailOrNull(args.customerEmail);

  if (!phone && !email) return null;

  let existing:
    | { id: string; full_name: string; phone: string | null; email: string | null }
    | null = null;

  if (phone) {
    const { data, error } = await sb
      .from("customers")
      .select("id, full_name, phone, email")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) existing = data;
  }

  if (!existing && email) {
    const { data, error } = await sb
      .from("customers")
      .select("id, full_name, phone, email")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) existing = data;
  }

  if (existing?.id) {
    const patch: any = {};
    if (full_name && !existing.full_name) patch.full_name = full_name;
    if (phone && !existing.phone) patch.phone = phone;
    if (email && !existing.email) patch.email = email;

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      const { error } = await sb
        .from("customers")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", existing.id);

      if (error) throw error;
    }

    return existing.id;
  }

  const { data: created, error: insErr } = await sb
    .from("customers")
    .insert({
      tenant_id: tenantId,
      full_name: full_name ?? "Cliente",
      phone,
      email,
    })
    .select("id")
    .single();

  if (insErr) throw insErr;
  return created.id as string;
}

// ✅ NEW: generar token robusto (Node/Next runtime)
function generateManageToken(): string {
  // crypto.randomUUID() suele estar disponible en Node 18+ (Next.js)
  // y es suficientemente robusto para enlace privado
  // Si quieres más corto: .replace(/-/g,"")
  return crypto.randomUUID();
}

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

    const resolvedCustomerId = await resolveCustomerId({
      sb,
      tenantId,
      customerId: customerId ?? null,
      customerName: customerName ?? null,
      customerPhone: customerPhone ?? null,
      customerEmail: customerEmail ?? null,
    });

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

    // ✅ NEW: token privado SIEMPRE
    const manage_token = generateManageToken();

    const payload = {
      tenant_id: tenantId,
      professional_id: professionalId,
      start_at: startAt,
      end_at: endAt,

      customer_name: customerName,
      customer_phone: customerPhone ?? null,
      customer_email: customerEmail ?? null,

      customer_id: resolvedCustomerId ?? null,

      service_id: serviceId ?? null,

      service_name,
      description,

      notes: notes ?? null,
      currency: currency ?? "CLP",
      status: status ?? "confirmed",

      source: "admin",

      // ✅ GUARDA TOKEN
      manage_token,
    };

    const { data, error } = await sb
      .from("appointments")
      .insert(payload)
      .select("id, manage_token")
      .single();

    if (error) throw error;

    const webhookBase = process.env.N8N_CONFIRMATION_WEBHOOK_URL;
    const secret = process.env.CITAYA_SECRET;

    if (!webhookBase) {
      console.warn("[appointments/create] N8N_CONFIRMATION_WEBHOOK_URL no seteada");
    } else {
      try {
        const url = new URL(webhookBase);
        if (secret) url.searchParams.set("secret", secret);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        await fetch(url.toString(), {
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
            customerId: resolvedCustomerId ?? null,

            serviceId: serviceId ?? null,
            service_name,
            description,

            notes: notes ?? null,
            currency: currency ?? "CLP",
            status: status ?? "confirmed",

            // ✅ NEW: manda el token a n8n (así el email siempre lo puede usar)
            manage_token: data.manage_token,

            source: "citaya-api",
            createdAt: new Date().toISOString(),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
      } catch (err: any) {
        console.error("[appointments/create] n8n webhook error:", err?.message || err);
      }
    }

    return NextResponse.json({
      ok: true,
      appointmentId: data.id,
      manageToken: data.manage_token,
      customerId: resolvedCustomerId ?? null,
    });
  } catch (e: any) {
    console.error("[appointments/create] error:", e?.message || e);

    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error inesperado" },
      { status: 500 },
    );
  }
}
