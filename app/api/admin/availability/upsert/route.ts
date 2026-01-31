import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type IncomingBlock = {
  id?: string | null;      // uuid si existe
  day_of_week: number;     // 0-6
  start_time: string;      // "HH:MM" (o "HH:MM:SS")
  end_time: string;        // "HH:MM" (o "HH:MM:SS")
  is_active?: boolean;
};

function normalizeHHMM(t: string) {
  if (!t) return "";
  const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return "";
  return `${m[1]}:${m[2]}`; // "HH:MM"
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return a.start < b.end && b.start < a.end;
}

export async function POST(req: Request) {
  try {
    const host = req.headers.get("host") || "";
    const tenantSlug = getTenantSlugFromHostname(host);

    const body = await req.json().catch(() => ({}));

    const professionalId: string | undefined = body?.professionalId;

    // ✅ FIX: tu frontend manda "items", no "blocks"
    const rawBlocks: IncomingBlock[] = Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.blocks)
      ? body.blocks
      : [];

    if (!professionalId) {
      return NextResponse.json({ error: "professionalId requerido" }, { status: 400 });
    }

    // Si viene vacío, respondemos claro para que no sea “200 fantasma”
    if (rawBlocks.length === 0) {
      return NextResponse.json(
        { error: "No llegaron bloques (items/blocks vacío). Revisa payload." },
        { status: 400 }
      );
    }

    // tenant
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .single();

    if (tenantErr || !tenant?.id) {
      return NextResponse.json({ error: "tenant no encontrado" }, { status: 404 });
    }

    // profesional pertenece al tenant
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("professionals")
      .select("id")
      .eq("id", professionalId)
      .eq("tenant_id", tenant.id)
      .single();

    if (profErr || !prof?.id) {
      return NextResponse.json({ error: "profesional inválido para este tenant" }, { status: 403 });
    }

    // --- Validaciones + normalización ---
    const normalized = rawBlocks.map((b) => {
      const st = normalizeHHMM(b.start_time);
      const et = normalizeHHMM(b.end_time);
      return {
        id: b.id ?? null,
        day_of_week: b.day_of_week,
        start_time: st,
        end_time: et,
        is_active: b.is_active ?? true,
      };
    });

    for (const b of normalized) {
      if (b.day_of_week < 0 || b.day_of_week > 6) {
        return NextResponse.json({ error: "day_of_week fuera de rango (0-6)" }, { status: 400 });
      }
      if (!b.start_time || !b.end_time) {
        return NextResponse.json({ error: "start_time/end_time requeridos" }, { status: 400 });
      }
      if (b.start_time >= b.end_time) {
        return NextResponse.json({ error: "start_time debe ser menor que end_time" }, { status: 400 });
      }
    }

    // no cruces por día
    const byDay = new Map<number, typeof normalized>();
    for (const b of normalized) {
      const arr = byDay.get(b.day_of_week) ?? [];
      arr.push(b);
      byDay.set(b.day_of_week, arr);
    }

    for (const [day, arr] of byDay.entries()) {
      const sorted = [...arr].sort((x, y) => x.start_time.localeCompare(y.start_time));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].start_time >= sorted[i].end_time) break;
          if (
            overlaps(
              { start: sorted[i].start_time, end: sorted[i].end_time },
              { start: sorted[j].start_time, end: sorted[j].end_time }
            )
          ) {
            return NextResponse.json(
              {
                error: `Cruce de horarios en día ${day}: ${sorted[i].start_time}-${sorted[i].end_time} con ${sorted[j].start_time}-${sorted[j].end_time}`,
              },
              { status: 400 }
            );
          }
        }
      }
    }

    // --- Leer existentes ---
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("availability")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("professional_id", professionalId);

    if (exErr) {
      return NextResponse.json({ error: exErr.message }, { status: 500 });
    }

    const existingIds = new Set((existing ?? []).map((r) => r.id));
    const incomingIds = new Set(normalized.filter((b) => b.id).map((b) => b.id as string));

    for (const id of incomingIds) {
      if (!existingIds.has(id)) {
        return NextResponse.json(
          { error: "Bloque inválido: id no pertenece a este profesional/tenant" },
          { status: 403 }
        );
      }
    }

    const toDelete = (existing ?? [])
      .map((r) => r.id)
      .filter((id) => !incomingIds.has(id));

    const toUpdate = normalized.filter((b) => !!b.id);
    const toInsert = normalized.filter((b) => !b.id);

    let deleted = 0;
    let updated = 0;
    let inserted = 0;

    // DELETE
    if (toDelete.length > 0) {
      const del = await supabaseAdmin
        .from("availability")
        .delete()
        .in("id", toDelete)
        .eq("tenant_id", tenant.id)
        .eq("professional_id", professionalId);

      if (del.error) {
        return NextResponse.json({ error: del.error.message }, { status: 500 });
      }
      deleted = toDelete.length;
    }

    // UPDATE (upsert por id)
    if (toUpdate.length > 0) {
      const rows = toUpdate.map((b) => ({
        id: b.id,
        tenant_id: tenant.id,
        professional_id: professionalId,
        day_of_week: b.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        is_active: b.is_active,
      }));

      const up = await supabaseAdmin.from("availability").upsert(rows as any, { onConflict: "id" });

      if (up.error) {
        return NextResponse.json({ error: up.error.message }, { status: 500 });
      }
      updated = rows.length;
    }

    // INSERT
    if (toInsert.length > 0) {
      const rows = toInsert.map((b) => ({
        tenant_id: tenant.id,
        professional_id: professionalId,
        day_of_week: b.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        is_active: b.is_active,
      }));

      const ins = await supabaseAdmin.from("availability").insert(rows as any);
      if (ins.error) {
        return NextResponse.json({ error: ins.error.message }, { status: 500 });
      }
      inserted = rows.length;
    }

    // --- Devolver estado final ---
    const { data: items, error: readErr } = await supabaseAdmin
      .from("availability")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("tenant_id", tenant.id)
      .eq("professional_id", professionalId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      inserted,
      updated,
      deleted,
      items: items ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
