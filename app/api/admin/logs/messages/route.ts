export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type MessageLogPayload = {
  type?: string;
  recipient?: string;
  subject?: string | null;
  status?: string;
  errorMessage?: string | null;
  tenantSlug?: string;
};

const ALLOWED_TYPES = new Set(["payment_resend", "campaign"]);
const ALLOWED_STATUSES = new Set(["sent", "error"]);

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function getTenantSlug(req: Request, body: MessageLogPayload) {
  const explicit = String(body.tenantSlug ?? "").trim();
  if (explicit) return explicit;

  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  return getTenantSlugFromHostname(host);
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

    const body = (await req.json().catch(() => null)) as MessageLogPayload | null;
    if (!body || typeof body !== "object") return badRequest("JSON invalido");

    const payload = {
      type: String(body.type ?? "").trim(),
      recipient: String(body.recipient ?? "").trim(),
      subject: String(body.subject ?? "").trim(),
      status: String(body.status ?? "").trim(),
      errorMessage: String(body.errorMessage ?? "").trim(),
    };

    if (!ALLOWED_TYPES.has(payload.type)) return badRequest("type invalido");
    if (!payload.recipient) return badRequest("recipient requerido");
    if (!ALLOWED_STATUSES.has(payload.status)) return badRequest("status invalido");

    const tenantSlug = getTenantSlug(req, body);
    if (!tenantSlug) return badRequest("tenantSlug requerido");

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (tenantError || !tenant?.id) {
      return NextResponse.json(
        { ok: false, error: tenantError?.message ?? "Tenant no encontrado" },
        { status: 404 },
      );
    }

    const { error } = await supabaseAdmin.from("message_logs").insert({
      tenant_id: tenant.id,
      type: payload.type,
      recipient: payload.recipient,
      subject: payload.subject || null,
      status: payload.status,
      error_message: payload.errorMessage || null,
    });

    if (error) {
      console.error("[api/admin/logs/messages] insert error:", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[api/admin/logs/messages] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error guardando log" },
      { status: 500 },
    );
  }
}
