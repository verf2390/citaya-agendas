// app/api/admin/service-rules/upsert/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type RowIn = {
  id?: string | null;
  tenant_id?: string;
  professional_id?: string;
  service_id?: string;
  day_of_week: number; // 0..6
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  is_active?: boolean;
};

function normalizeDowToJs0_6(dow: any) {
  const n = Number(dow);
  if (!Number.isFinite(n)) return 0;

  // si viene 1..7 (Lun..Dom)
  if (n >= 1 && n <= 7) return n === 7 ? 0 : n;

  // si viene JS 0..6
  if (n >= 0 && n <= 6) return n;

  return ((n % 7) + 7) % 7;
}

function cleanIdAndNormalize(row: RowIn) {
  const r: any = { ...row };

  // ✅ CLAVE: si id viene null / "" / undefined -> NO enviarlo
  // OJO: si viene "null" (string) también lo sacamos.
  const id = (r.id ?? "") as string;
  const idTrim = String(id).trim();
  if (!idTrim || idTrim.toLowerCase() === "null" || idTrim.toLowerCase() === "undefined") {
    delete r.id;
  } else {
    r.id = idTrim;
  }

  // normalizaciones
  r.day_of_week = normalizeDowToJs0_6(r.day_of_week);
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

    // ✅ armamos rows SEGURAS (nunca mandan id:null)
    const rows = items.map((x) =>
      cleanIdAndNormalize({
        ...x,
        tenant_id: tenantId,
        professional_id: professionalId,
        service_id: serviceId,
      }),
    );

    // ✅ EXTRA DEFENSIVO: separamos inserts/updates
    // - inserts: SIN id => Postgres usa default gen_random_uuid()
    // - updates: CON id => upsert por id
    const inserts = rows.filter((r: any) => !("id" in r));
    const updates = rows.filter((r: any) => "id" in r);

    if (inserts.length > 0) {
      const { error } = await supabaseServer
        .from("service_availability_rules")
        .insert(inserts);
      if (error) {
        console.error("service-rules insert error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (updates.length > 0) {
      const { error } = await supabaseServer
        .from("service_availability_rules")
        .upsert(updates, { onConflict: "id" });
      if (error) {
        console.error("service-rules upsert error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      inserted: inserts.length,
      upserted: updates.length,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
