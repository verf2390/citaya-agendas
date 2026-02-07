import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type RowIn = {
  id?: string | null;
  tenant_id: string;
  professional_id: string;
  service_id: string;
  day_of_week: number; // 0..6
  start_time: string;  // "HH:MM"
  end_time: string;    // "HH:MM"
  is_active?: boolean;
};

function cleanId(row: RowIn) {
  const r: any = { ...row };

  // ✅ CLAVE: si id viene null / "" / undefined -> NO enviarlo
  if (!r.id) delete r.id;

  // normalizaciones suaves
  r.day_of_week = Number(r.day_of_week);
  r.start_time = String(r.start_time || "").slice(0, 5);
  r.end_time = String(r.end_time || "").slice(0, 5);
  r.is_active = r.is_active === false ? false : true;

  return r;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const tenantId = body?.tenantId as string | undefined;
    const professionalId = body?.professionalId as string | undefined;
    const serviceId = body?.serviceId as string | undefined;
    const items = (body?.items ?? []) as RowIn[];

    if (!tenantId || !professionalId || !serviceId) {
      return NextResponse.json(
        { error: "Faltan tenantId/professionalId/serviceId" },
        { status: 400 },
      );
    }

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "items inválido" }, { status: 400 });
    }

    // ✅ añadimos llaves y limpiamos id
    const rows = items.map((x) =>
      cleanId({
        ...x,
        tenant_id: tenantId,
        professional_id: professionalId,
        service_id: serviceId,
      }),
    );

    // ✅ upsert por id (si no hay id -> insert; si hay id -> update)
    const { error } = await supabaseServer
      .from("service_availability_rules")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      console.error("service-rules upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
