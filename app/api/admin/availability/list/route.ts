import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const professionalId = (searchParams.get("professionalId") || "").trim();
    if (!professionalId) {
      return NextResponse.json({ error: "professionalId requerido" }, { status: 400 });
    }

    if (!isUuid(professionalId)) {
      return NextResponse.json({ error: "professionalId inválido" }, { status: 400 });
    }

    const auth = await requireTenantAdmin(req);
    if (!auth.ok) return auth.response;

    const tenantId = auth.tenantId;

    // ✅ Verifica que el profesional pertenece al tenant (seguridad multi-tenant)
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("professionals")
      .select("id")
      .eq("id", professionalId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (profErr) {
      console.error("[admin/availability/list] professional lookup error:", profErr);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }

    if (!prof?.id) {
      return NextResponse.json({ error: "profesional inválido para este tenant" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("availability")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("tenant_id", tenantId)
      .eq("professional_id", professionalId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      console.error("[admin/availability/list] availability query error:", error);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }

    return NextResponse.json({ tenant_id: tenantId, items: data ?? [] });
  } catch (e: any) {
    console.error("[admin/availability/list] unexpected:", e?.message || e);
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
