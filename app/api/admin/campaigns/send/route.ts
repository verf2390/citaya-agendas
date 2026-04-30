export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type CampaignPayload = {
  type?: string;
  segment?: string;
  subject?: string;
  message?: string;
  tenantSlug?: string;
};

type TenantBranding = {
  id: string;
  name: string | null;
  logo_url: string | null;
  phone_display?: string | null;
  whatsapp?: string | null;
};

const ALLOWED_TYPES = new Set(["promo", "vacation", "discount", "custom"]);
const ALLOWED_SEGMENTS = new Set([
  "all",
  "recurring",
  "inactive",
  "pending_payment",
]);

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
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
    type: "campaign";
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
    console.error("[api/admin/campaigns/send] log ignored:", e?.message || e);
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

    const body = (await req.json().catch(() => null)) as CampaignPayload | null;
    if (!body || typeof body !== "object") return badRequest("JSON invalido");

    const payload = {
      type: String(body.type ?? "").trim(),
      segment: String(body.segment ?? "").trim(),
      subject: String(body.subject ?? "").trim(),
      message: String(body.message ?? "").trim(),
      tenantSlug: String(body.tenantSlug ?? "").trim(),
    };

    if (!ALLOWED_TYPES.has(payload.type)) return badRequest("type invalido");
    if (!ALLOWED_SEGMENTS.has(payload.segment)) return badRequest("segment invalido");
    if (!payload.subject) return badRequest("subject requerido");
    if (!payload.message) return badRequest("message requerido");
    if (!payload.tenantSlug) return badRequest("tenantSlug requerido");

    const tenant = await fetchTenantBranding(payload.tenantSlug);
    if (!tenant?.id) return badRequest("tenantSlug invalido");

    const webhookPayload = {
      ...payload,
      businessName: tenant.name?.trim() || payload.tenantSlug,
      logoUrl: tenant.logo_url?.trim() || "",
      whatsapp:
        tenant.whatsapp?.trim() || tenant.phone_display?.trim() || "",
      source: "citaya-admin-campaigns",
    };

    const webhookUrl = process.env.N8N_CAMPAIGNS_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json({
        ok: false,
        placeholder: true,
        message: "Campañas listas visualmente. Falta configurar n8n para envios reales.",
      });
    }

    // TODO: validar consentimiento, auditoria y logs por destinatario antes de habilitar envio masivo real.
    let n8nRes: Response;
    try {
      n8nRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      });
    } catch (e: any) {
      console.error("[api/admin/campaigns/send] n8n fetch error:", e?.message || e);
      await logMessage(req, token, {
        tenantSlug: payload.tenantSlug,
        type: "campaign",
        recipient: `segment:${payload.segment}`,
        subject: payload.subject,
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
      console.error("[api/admin/campaigns/send] n8n error:", {
        status: n8nRes.status,
        detail,
      });
      await logMessage(req, token, {
        tenantSlug: payload.tenantSlug,
        type: "campaign",
        recipient: `segment:${payload.segment}`,
        subject: payload.subject,
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
      type: "campaign",
      recipient: `segment:${payload.segment}`,
      subject: payload.subject,
      status: "sent",
    });

    return NextResponse.json({
      ok: true,
      message: "Campaña enviada a automatizacion",
    });
  } catch (e: any) {
    console.error("[api/admin/campaigns/send] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error enviando campana" },
      { status: 500 },
    );
  }
}
