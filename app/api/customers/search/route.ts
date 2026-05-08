export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "";
    const q = (searchParams.get("q") || "").trim();

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json({ ok: false, error: "tenantId requerido o inválido" }, { status: 400 });
    }
    const auth = await requireTenantAdmin(req, { tenantId });
    if (!auth.ok) return auth.response;

    if (q.length < 2) {
      return NextResponse.json({ ok: true, customers: [] });
    }

    const qDigits = q.replace(/\D/g, "");
    const like = `%${q}%`;

    // ✅ buscar por nombre y/o teléfono
    let query = supabaseAdmin
      .from("customers")
      .select("id, full_name, phone, email")
      .eq("tenant_id", auth.tenantId)
      .order("full_name", { ascending: true })
      .limit(20);

    if (qDigits.length >= 3) {
      query = query.or(`full_name.ilike.${like},phone.ilike.%${qDigits}%`);
    } else {
      query = query.ilike("full_name", like);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, customers: data ?? [] });
  } catch (e: any) {
    console.error("[api/customers/search] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error buscando customers" },
      { status: 500 },
    );
  }
}
