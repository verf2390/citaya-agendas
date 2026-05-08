export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type MessageLogPayload = {
  type?: string;
  recipient?: string;
  subject?: string | null;
  status?: string;
  errorMessage?: string | null;
  tenantId?: string;
  tenantSlug?: string;
  campaignId?: string | null;
  templateKey?: string | null;
  segmentKey?: string | null;
  channel?: string | null;
  mediaType?: string | null;
  recipientCount?: number | string | null;
  recipientName?: string | null;
  headline?: string | null;
};

const ALLOWED_TYPES = new Set(["payment_resend", "campaign"]);
const ALLOWED_STATUSES = new Set(["sent", "error"]);
const ALLOWED_MEDIA_TYPES = new Set(["none", "image", "gif", "video"]);

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getTenantSlug(req: Request, body: MessageLogPayload) {
  const explicit = String(body.tenantSlug ?? "").trim();
  if (explicit) return explicit;

  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  return getTenantSlugFromHostname(host);
}

function getTenantId(req: Request, body: MessageLogPayload) {
  const explicit = String(body.tenantId ?? "").trim();
  if (explicit) return explicit;

  const url = new URL(req.url);
  return String(url.searchParams.get("tenantId") ?? "").trim();
}

function isMissingMessageLogsTable(message: string) {
  return /Could not find the table 'public\.message_logs'|relation .*message_logs.* does not exist/i.test(
    message,
  );
}

function isMissingOptionalLogColumn(message: string) {
  return /campaign_id|template_key|segment_key|channel|media_type|recipient_count|recipient_name|headline|metadata/i.test(
    message,
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as MessageLogPayload | null;
    if (!body || typeof body !== "object") return badRequest("JSON invalido");

    const payload = {
      type: String(body.type ?? "").trim(),
      recipient: String(body.recipient ?? "").trim(),
      subject: String(body.subject ?? "").trim(),
      status: String(body.status ?? "").trim(),
      errorMessage: String(body.errorMessage ?? "").trim(),
      campaignId: String(body.campaignId ?? "").trim(),
      templateKey: String(body.templateKey ?? "").trim(),
      segmentKey: String(body.segmentKey ?? "").trim(),
      channel: String(body.channel ?? "email").trim().toLowerCase(),
      mediaType: String(body.mediaType ?? "none").trim().toLowerCase(),
      recipientCount: Math.max(0, Math.floor(Number(body.recipientCount ?? 0))),
      recipientName: String(body.recipientName ?? "").trim(),
      headline: String(body.headline ?? "").trim(),
    };

    if (!ALLOWED_TYPES.has(payload.type)) return badRequest("type invalido");
    if (!payload.recipient) return badRequest("recipient requerido");
    if (!ALLOWED_STATUSES.has(payload.status)) return badRequest("status invalido");
    if (!ALLOWED_MEDIA_TYPES.has(payload.mediaType)) return badRequest("mediaType invalido");

    const tenantSlug = getTenantSlug(req, body);
    const tenantId = getTenantId(req, body);
    if (!tenantId && !tenantSlug) return badRequest("tenantId o tenantSlug requerido");

    const auth = await requireTenantAdmin(req, { tenantId, tenantSlug });
    if (!auth.ok) return auth.response;

    const insertPayload = {
      tenant_id: auth.tenantId,
      type: payload.type,
      recipient: payload.recipient,
      subject: payload.subject || null,
      status: payload.status,
      error_message: payload.errorMessage || null,
      recipient_name: payload.recipientName || null,
      headline: payload.headline || null,
      campaign_id: payload.campaignId || null,
      template_key: payload.templateKey || null,
      segment_key: payload.segmentKey || null,
      channel: payload.channel || "email",
      media_type: payload.mediaType,
      recipient_count: payload.recipientCount || null,
      metadata: payload.campaignId
        ? {
            campaignId: payload.campaignId,
            templateKey: payload.templateKey || null,
            segmentKey: payload.segmentKey || null,
            channel: payload.channel || "email",
            mediaType: payload.mediaType,
            recipientCount: payload.recipientCount || null,
          }
        : null,
    };

    const { error } = await supabaseAdmin.from("message_logs").insert(insertPayload);

    if (error && isMissingOptionalLogColumn(error.message)) {
      const { error: fallbackError } = await supabaseAdmin.from("message_logs").insert({
        tenant_id: auth.tenantId,
        type: payload.type,
        recipient: payload.recipient,
        subject: payload.subject || null,
        status: payload.status,
        error_message: payload.errorMessage || null,
      });

      if (fallbackError) {
        console.error("[api/admin/logs/messages] fallback insert error:", fallbackError);
        return NextResponse.json(
          { ok: false, error: fallbackError.message },
          { status: 500 },
        );
      }

      return NextResponse.json({ ok: true, metadataStored: false });
    }

    if (error) {
      console.error("[api/admin/logs/messages] insert error:", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("[api/admin/logs/messages] error:", getErrorMessage(e, String(e)));
    return NextResponse.json(
      { ok: false, error: getErrorMessage(e, "Error guardando log") },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
    const tenantSlug = getTenantSlug(req, {
      tenantId,
      tenantSlug: url.searchParams.get("tenantSlug") ?? "",
    });
    if (!tenantId && !tenantSlug) return badRequest("tenantId o tenantSlug requerido");

    const auth = await requireTenantAdmin(req, { tenantId, tenantSlug });
    if (!auth.ok) return auth.response;

    const { data, error } = await supabaseAdmin
      .from("message_logs")
      .select(
        "id, type, recipient, recipient_name, subject, headline, status, error_message, created_at, campaign_id, template_key, segment_key, channel, media_type, recipient_count, metadata",
      )
      .eq("tenant_id", auth.tenantId)
      .eq("type", "campaign")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error && isMissingMessageLogsTable(error.message)) {
      console.info("[logs/messages] campaign history", {
        tenantId: auth.tenantId,
        count: 0,
        error: error.message,
      });
      return NextResponse.json({
        ok: true,
        setupRequired: true,
        error: error.message,
        logs: [],
      });
    }

    if (error && isMissingOptionalLogColumn(error.message)) {
      const fallback = await supabaseAdmin
        .from("message_logs")
        .select("id, type, recipient, subject, status, error_message, created_at")
        .eq("tenant_id", auth.tenantId)
        .eq("type", "campaign")
        .order("created_at", { ascending: false })
        .limit(500);

      if (fallback.error) {
        if (isMissingMessageLogsTable(fallback.error.message)) {
          console.info("[logs/messages] campaign history", {
            tenantId: auth.tenantId,
            count: 0,
            error: fallback.error.message,
          });
          return NextResponse.json({
            ok: true,
            setupRequired: true,
            error: fallback.error.message,
            logs: [],
          });
        }
        console.error("[api/admin/logs/messages] fallback fetch error:", fallback.error);
        return NextResponse.json(
          { ok: false, error: fallback.error.message },
          { status: 500 },
        );
      }

      console.info("[logs/messages] campaign history", {
        tenantId: auth.tenantId,
        count: fallback.data?.length ?? 0,
        error: null,
      });
      return NextResponse.json({
        ok: true,
        metadataStored: false,
        logs: fallback.data ?? [],
      });
    }

    if (error) {
      console.error("[api/admin/logs/messages] fetch error:", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    console.info("[logs/messages] campaign history", {
      tenantId: auth.tenantId,
      count: data?.length ?? 0,
      error: null,
    });
    return NextResponse.json({ ok: true, metadataStored: true, logs: data ?? [] });
  } catch (e: unknown) {
    console.error("[api/admin/logs/messages] get error:", getErrorMessage(e, String(e)));
    return NextResponse.json(
      { ok: false, error: getErrorMessage(e, "Error leyendo logs") },
      { status: 500 },
    );
  }
}
