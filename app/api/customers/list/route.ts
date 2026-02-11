export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

export async function GET(req: Request) {
  try {
    // ✅ Auth por Bearer token (JWT de Supabase)
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    // ✅ Verificar token con Supabase Admin
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(
      token,
    );

    if (userErr || !userData?.user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "";
    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido" },
        { status: 400 },
      );
    }

    // ✅ Listar customers por tenant (service role)
    const { data: customers, error } = await supabaseAdmin
      .from("customers")
      .select("id, tenant_id, full_name, phone, email, notes, created_at")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true })
      .limit(1000);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, customers: customers ?? [] });
  } catch (e: any) {
    console.error("[api/customers/list] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error listando customers" },
      { status: 500 },
    );
  }
}
