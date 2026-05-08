import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const auth = await requireTenantAdmin(req);
    if (!auth.ok) return auth.response;

    // 2) Listar profesionales SOLO del tenant
    const { data, error } = await supabaseAdmin
      .from("professionals")
      .select("id, tenant_id, name, active, bio, avatar_url, created_at")
      .eq("tenant_id", auth.tenantId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[admin/professionals/list] db error:", error);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }

    // ✅ Respuesta consistente con el front corregido:
    // - professionals incluye tenant_id por item
    // - tenant_id top-level
    return NextResponse.json({
      tenant_id: auth.tenantId,
      professionals: data ?? [],
    });
  } catch (e: any) {
    console.error("[admin/professionals/list] unexpected:", e?.message || e);
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
