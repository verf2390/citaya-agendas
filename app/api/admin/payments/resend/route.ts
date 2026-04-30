export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PaymentResendPayload = {
  appointmentId?: string;
  customerEmail?: string;
  customerName?: string | null;
  paymentLink?: string;
  amount?: number | string | null;
  tenantSlug?: string;
};

type TenantBranding = {
  id: string;
  name: string | null;
  logo_url: string | null;
  phone_display?: string | null;
  whatsapp?: string | null;
};

type AppointmentBranding = {
  id: string;
  tenant_id: string | null;
  service_name: string | null;
  start_at: string | null;
};

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchTenantBranding(tenantSlug: string): Promise<TenantBranding | null> {
  const withWhatsapp = await supabaseAdmin
    .from("tenants")
    .select("id, name, logo_url, phone_display, whatsapp")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (!withWhatsapp.error && withWhatsapp.data?.id) {
    return withWhatsapp.data as TenantBranding;
  }

  const fallback = await supabaseAdmin
    .from("tenants")
    .select("id, name, logo_url, phone_display")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (fallback.error || !fallback.data?.id) return null;
  return fallback.data as TenantBranding;
}

async function logMessage(
  req: Request,
  token: string,
  body: {
    tenantSlug: string;
    type: "payment_resend";
    recipient: string;
    subject: string;
    status: "sent" | "error";
    errorMessage?: string;
  },
) {
  try {
    await fetch(new URL("/api/admin/logs/messages", req.url).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    console.error("[api/admin/payments/resend] log ignored:", e?.message || e);
  }
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as PaymentResendPayload | null;
    if (!body || typeof body !== "object") return badRequest("JSON invalido");

    const payload = {
      appointmentId: String(body.appointmentId ?? "").trim(),
      customerEmail: String(body.customerEmail ?? "").trim().toLowerCase(),
      customerName: String(body.customerName ?? "").trim(),
      paymentLink: String(body.paymentLink ?? "").trim(),
      amount: Number(body.amount ?? 0),
      tenantSlug: String(body.tenantSlug ?? "").trim(),
    };

    if (!payload.appointmentId) return badRequest("appointmentId requerido");
    if (!payload.customerEmail || !isEmail(payload.customerEmail)) {
      return badRequest("customerEmail valido requerido");
    }
    if (!payload.paymentLink || !isHttpUrl(payload.paymentLink)) {
      return badRequest("paymentLink valido requerido");
    }
    if (!payload.tenantSlug) return badRequest("tenantSlug requerido");
    if (!Number.isFinite(payload.amount) || payload.amount < 0) {
      return badRequest("amount invalido");
    }

    const tenant = await fetchTenantBranding(payload.tenantSlug);
    if (!tenant?.id) return badRequest("tenantSlug invalido");

    const { data: appointment } = await supabaseAdmin
      .from("appointments")
      .select("id, tenant_id, service_name, start_at")
      .eq("id", payload.appointmentId)
      .eq("tenant_id", tenant.id)
      .maybeSingle<AppointmentBranding>();

    const businessName = tenant.name?.trim() || payload.tenantSlug;
    const logoUrl = tenant.logo_url?.trim() || "";
    const whatsapp =
      tenant.whatsapp?.trim() || tenant.phone_display?.trim() || "";
    const enrichedPayload = {
      ...payload,
      businessName,
      logoUrl,
      whatsapp,
      serviceName: appointment?.service_name?.trim() || "",
      appointmentDate: appointment?.start_at || "",
      appointmentTime: appointment?.start_at || "",
      source: "citaya-admin-payment-resend",
    };
    const logSubject = `Reenvio de pago - ${businessName}`;

    const webhookUrl = process.env.N8N_PAYMENT_RESEND_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json({
        ok: false,
        placeholder: true,
        message: "Webhook n8n no configurado",
      });
    }

    let n8nRes: Response;
    try {
      n8nRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enrichedPayload),
      });
    } catch (e: any) {
      console.error("[api/admin/payments/resend] n8n fetch error:", e?.message || e);
      await logMessage(req, token, {
        tenantSlug: payload.tenantSlug,
        type: "payment_resend",
        recipient: payload.customerEmail,
        subject: logSubject,
        status: "error",
        errorMessage: e?.message || "No se pudo conectar con n8n",
      });
      return NextResponse.json(
        { ok: false, error: "No se pudo conectar con n8n" },
        { status: 502 },
      );
    }

    if (!n8nRes.ok) {
      const detail = await n8nRes.text().catch(() => "");
      console.error("[api/admin/payments/resend] n8n error:", {
        status: n8nRes.status,
        detail,
      });
      await logMessage(req, token, {
        tenantSlug: payload.tenantSlug,
        type: "payment_resend",
        recipient: payload.customerEmail,
        subject: logSubject,
        status: "error",
        errorMessage: `n8n respondio con error (${n8nRes.status})`,
      });
      return NextResponse.json(
        { ok: false, error: `n8n respondio con error (${n8nRes.status})` },
        { status: 502 },
      );
    }

    await logMessage(req, token, {
      tenantSlug: payload.tenantSlug,
      type: "payment_resend",
      recipient: payload.customerEmail,
      subject: logSubject,
      status: "sent",
    });

    return NextResponse.json({
      ok: true,
      message: "Correo de pago reenviado correctamente",
    });
  } catch (e: any) {
    console.error("[api/admin/payments/resend] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error reenviando pago" },
      { status: 500 },
    );
  }
}
