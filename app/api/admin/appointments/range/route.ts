// app/api/admin/appointments/range/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function toIsoOrEmpty(v: string) {
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString();
  } catch {
    return "";
  }
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const tenantId = String(searchParams.get("tenantId") || "").trim();
    const professionalId = String(searchParams.get("professionalId") || "").trim();
    const startRaw = String(searchParams.get("start") || "").trim();
    const endRaw = String(searchParams.get("end") || "").trim();

    if (!tenantId || !startRaw || !endRaw) {
      return NextResponse.json(
        { error: "tenantId/start/end required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (!isUuid(tenantId)) {
      return NextResponse.json(
        { error: "invalid tenantId" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (professionalId && !isUuid(professionalId)) {
      return NextResponse.json(
        { error: "invalid professionalId" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const start = toIsoOrEmpty(startRaw);
    const end = toIsoOrEmpty(endRaw);

    if (!start || !end) {
      return NextResponse.json(
        { error: "invalid start/end date" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (!(new Date(end).getTime() > new Date(start).getTime())) {
      return NextResponse.json(
        { error: "end must be > start" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    let q = supabaseAdmin
      .from("appointments")
      .select(
        `
        id,
        tenant_id,
        professional_id,
        customer_id,
        customer_name,
        customer_phone,
        start_at,
        end_at,
        status
      `,
      )
      .eq("tenant_id", tenantId)
      .order("start_at", { ascending: true })
      .limit(2000);

    if (professionalId) {
      q = q.eq("professional_id", professionalId);
    }

    // ✅ overlap real
    q = q.lt("start_at", end).gt("end_at", start);

    const { data, error } = await q;

    if (error) {
      console.error("[admin/appointments/range] db error:", error);
      return NextResponse.json(
        { error: "db error" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        count: data?.length ?? 0,
        items: data ?? [],
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e: any) {
    console.error("[admin/appointments/range] unexpected:", e?.message || e);
    return NextResponse.json(
      { error: e?.message ?? "unexpected" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
