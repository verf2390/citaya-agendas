export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ALLOWED_STATUSES = new Set([
  "active",
  "notified",
  "booked",
  "expired",
  "deleted",
]);

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

async function requireUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return false;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data?.user;
}

async function getContext(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireUser(req))) {
    return {
      error: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  const { id } = await context.params;
  const { searchParams } = new URL(req.url);
  const tenantId = String(searchParams.get("tenantId") || "").trim();

  if (!tenantId || !isUuid(tenantId)) {
    return {
      error: NextResponse.json(
        { ok: false, error: "tenantId requerido o inválido" },
        { status: 400 },
      ),
    };
  }

  if (!id || !isUuid(id)) {
    return {
      error: NextResponse.json(
        { ok: false, error: "waitlist id inválido" },
        { status: 400 },
      ),
    };
  }

  return { id, tenantId };
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await getContext(req, context);
    if (resolved.error) return resolved.error;

    const body = await req.json().catch(() => null);
    const status = String(body?.status || "").trim();

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        { ok: false, error: "status inválido" },
        { status: 400 },
      );
    }

    const patch: Record<string, string | null> = { status };
    if (status === "notified") patch.notified_at = new Date().toISOString();
    if (status === "deleted") patch.deleted_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("waitlist_requests")
      .update(patch)
      .eq("id", resolved.id)
      .eq("tenant_id", resolved.tenantId)
      .select("id, status, notified_at, deleted_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "No se pudo actualizar solicitud" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Solicitud no encontrada" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    console.error("[admin/waitlist/:id PATCH] error:", error);
    return NextResponse.json(
      { ok: false, error: "Error inesperado" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await getContext(req, context);
    if (resolved.error) return resolved.error;

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("waitlist_requests")
      .update({ status: "deleted", deleted_at: now })
      .eq("id", resolved.id)
      .eq("tenant_id", resolved.tenantId)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "No se pudo eliminar solicitud" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Solicitud no encontrada" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/waitlist/:id DELETE] error:", error);
    return NextResponse.json(
      { ok: false, error: "Error inesperado" },
      { status: 500 },
    );
  }
}
