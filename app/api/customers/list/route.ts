export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
 // ajusta si tu ruta es distinta

export async function GET(req: Request) {
  try {
    // ✅ GUARD: exige sesión
    const sb = supabaseServer;
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "";
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenantId requerido" }, { status: 400 });
    }

    const { data: customers, error } = await supabaseAdmin
      .from("customers")
      .select("id, tenant_id, full_name, phone, email, notes, created_at")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true })
      .limit(1000);

    if (error) throw error;

    return NextResponse.json({ ok: true, customers: customers ?? [] });
  } catch (e: any) {
    console.error("[admin/customers/list] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error listando customers" },
      { status: 500 }
    );
  }
}
