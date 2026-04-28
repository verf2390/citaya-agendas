export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type CampaignRecipient = {
  customer_id?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
};

type CampaignPayload = {
  tenant_id?: string;
  tenant_slug?: string;
  channel?: string;
  subject?: string;
  message?: string;
  campaign_image_url?: string;
  image_url?: string;
  banner_url?: string;
  recipients?: CampaignRecipient[];
};

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(
      token,
    );

    if (userErr || !userData?.user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => null)) as CampaignPayload | null;

    if (!body || typeof body !== "object") {
      return badRequest("JSON inválido");
    }

    const campaignImageUrl = String(
      body.campaign_image_url ||
        body.image_url ||
        body.banner_url ||
        "",
    )
      .trim()
      .replace(/\s/g, "");

    const payload = {
      tenant_id: body.tenant_id?.trim() || "",
      tenant_slug: body.tenant_slug?.trim() || "",
      channel: body.channel?.trim() || "",
      subject: body.subject?.trim() || "",
      message: body.message?.trim() || "",
      campaign_image_url: campaignImageUrl,
      recipients: Array.isArray(body.recipients) ? body.recipients : [],
    };

    if (!payload.tenant_id) return badRequest("tenant_id requerido");
    if (!payload.tenant_slug) return badRequest("tenant_slug requerido");
    if (!payload.channel) return badRequest("channel requerido");
    if (!payload.message) return badRequest("message requerido");
    if (!Array.isArray(body.recipients) || payload.recipients.length === 0) {
      return badRequest("recipients debe ser un array no vacío");
    }
    if (payload.channel === "email" && !payload.subject) {
      return badRequest("subject requerido para email");
    }

    const webhookUrl = process.env.N8N_CAMPAIGN_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { ok: false, error: "N8N_CAMPAIGN_WEBHOOK_URL no está configurada" },
        { status: 500 },
      );
    }

    let n8nRes: Response;
    try {
      n8nRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e: any) {
      console.error("[api/admin/messages/send] n8n fetch error:", e?.message || e);
      return NextResponse.json(
        { ok: false, error: "No se pudo conectar con n8n" },
        { status: 502 },
      );
    }

    if (!n8nRes.ok) {
      const detail = await n8nRes.text().catch(() => "");
      console.error("[api/admin/messages/send] n8n error:", {
        status: n8nRes.status,
        detail,
      });
      return NextResponse.json(
        {
          ok: false,
          error: `n8n respondió con error (${n8nRes.status})`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Campaña enviada a automatización",
      recipients_count: payload.recipients.length,
      has_image: Boolean(payload.campaign_image_url),
    });
  } catch (e: any) {
    console.error("[api/admin/messages/send] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error enviando campaña" },
      { status: 500 },
    );
  }
}