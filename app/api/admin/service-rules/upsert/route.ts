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

  // normalizaciones
  r.day_of_week = normalizeDowToJs0_6(r.day_of_week);
  r.start_time = String(r.start_time || "").slice(0, 5);
  r.end_time = String(r.end_time || "").slice(0, 5);
  r.is_active = r.is_active === false ? false : true;

  // ✅ IMPORTANTÍSIMO para modo REPLACE:
  // nunca insertamos con id (evita conflictos y deja que Postgres genere ids nuevos)
  delete r.id;

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

    // ✅ armamos rows SEGURAS (normalizadas + sin id)
    const rows = items.map((x) =>
      cleanIdAndNormalize({
        ...x,
        tenant_id: tenantId,
        professional_id: professionalId,
        service_id: serviceId,
      }),
    );

    // ✅ MODO REPLACE:
    // 1) borramos reglas anteriores de ESTE servicio/profesional/tenant
    // 2) insertamos exactamente las reglas que envía el admin
    const { error: delErr } = await supabaseServer
      .from("service_availability_rules")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("professional_id", professionalId)
      .eq("service_id", serviceId);

    if (delErr) {
      console.error("service-rules delete error:", delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    // si no hay bloques, quedará vacío (válido)
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, replaced: true });
    }

    const { error: insErr } = await supabaseServer
      .from("service_availability_rules")
      .insert(rows);

    if (insErr) {
      console.error("service-rules insert error:", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      inserted: rows.length,
      replaced: true,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
