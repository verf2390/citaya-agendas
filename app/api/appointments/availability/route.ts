// app/api/appointments/availability/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type AppointmentRangeRow = {
  start_at: string;
  end_at: string;
  status: string | null;
};

type AvailabilityRow = {
  day_of_week: number; // 0=domingo ... 6=sábado (guardado así en DB)
  start_time: string;  // "HH:MM:SS"
  end_time: string;    // "HH:MM:SS"
  is_active: boolean;
};

type BookedRange = { start: Date; end: Date };
type Slot = { start_at: string; end_at: string };

const TZ = "America/Santiago";

/**
 * Devuelve parts (año/mes/día/hora/min/seg) de una fecha en una timezone.
 */
function getPartsInTZ(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

/**
 * Calcula offset (minutos) entre UTC y la timezone para un instante.
 */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const p = getPartsInTZ(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (date.getTime() - asUTC) / 60000;
}

/**
 * Convierte un "wall time" (hora local Chile) a Date UTC real.
 * Se itera 2 veces para ajustar DST.
 */
function localToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  // 1) primer guess: tratar wall time como si fuera UTC
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // 2) calcular offset en esa TZ y corregir
  let offset = getTimeZoneOffsetMinutes(guess, timeZone);
  let utc = new Date(guess.getTime() + offset * 60000);

  // 3) segunda pasada (mejor con DST)
  offset = getTimeZoneOffsetMinutes(utc, timeZone);
  utc = new Date(guess.getTime() + offset * 60000);

  return utc;
}

/**
 * Devuelve day_of_week 0..6 calculado en TZ (Chile).
 */
function dayOfWeekCL(date: Date) {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(date);

  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return map[wd] ?? date.getDay();
}

/**
 * HH:MM:SS -> {hh, mm}
 */
function parseTimeHHMM(time: string) {
  const [hh, mm] = time.split(":");
  return { hh: Number(hh || 0), mm: Number(mm || 0) };
}

/**
 * Redondea hacia arriba a múltiplos de stepMinutes (en UTC) para slots consistentes.
 */
function ceilToStepUTC(date: Date, stepMinutes: number) {
  const stepMs = stepMinutes * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / stepMs) * stepMs);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const tenantId = url.searchParams.get("tenantId");
    const professionalId = url.searchParams.get("professionalId");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    // opcionales
    const durationMinParam = url.searchParams.get("durationMin"); // ej: 30, 45, 60
    const stepMinParam = url.searchParams.get("stepMin"); // ej: 15, 30

    if (!tenantId || !professionalId || !from || !to) {
      return NextResponse.json(
        { error: "Faltan parámetros: tenantId, professionalId, from, to" },
        { status: 400 },
      );
    }

    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);

    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      return NextResponse.json({ error: "from/to inválidos" }, { status: 400 });
    }
    if (rangeStart >= rangeEnd) {
      return NextResponse.json(
        { error: "Rango inválido: from debe ser menor que to" },
        { status: 400 },
      );
    }

    const durationMinutes = Math.max(
      5,
      Math.min(240, Number(durationMinParam ?? 30) || 30),
    );
    const stepMinutes = Math.max(
      5,
      Math.min(120, Number(stepMinParam ?? 30) || 30),
    );

    // 0) traer availability (bloques activos) del profesional
    const { data: avRows, error: avErr } = await supabaseServer
      .from("availability")
      .select("day_of_week,start_time,end_time,is_active")
      .eq("tenant_id", tenantId)
      .eq("professional_id", professionalId)
      .eq("is_active", true);

    if (avErr) {
      console.error(avErr);
      return NextResponse.json(
        { error: "Error consultando disponibilidad" },
        { status: 500 },
      );
    }

    const availability = (avRows ?? []) as AvailabilityRow[];

    // Map por day_of_week
    const blocksByDow: Record<number, AvailabilityRow[]> = {};
    for (const r of availability) {
      if (!blocksByDow[r.day_of_week]) blocksByDow[r.day_of_week] = [];
      blocksByDow[r.day_of_week].push(r);
    }
    // ordenar bloques por hora
    Object.keys(blocksByDow).forEach((k) => {
      blocksByDow[Number(k)].sort((a, b) =>
        a.start_time > b.start_time ? 1 : -1,
      );
    });

    // 1) traer citas existentes (bloquean slots) - filtramos por tenant+profesional
    const { data: appts, error: apptErr } = await supabaseServer
      .from("appointments")
      .select("start_at,end_at,status")
      .eq("tenant_id", tenantId)
      .eq("professional_id", professionalId)
      .neq("status", "canceled")
      .lt("start_at", rangeEnd.toISOString())
      .gt("end_at", rangeStart.toISOString());

    if (apptErr) {
      console.error(apptErr);
      return NextResponse.json(
        { error: "Error consultando citas" },
        { status: 500 },
      );
    }

    const booked: BookedRange[] = ((appts ?? []) as AppointmentRangeRow[]).map(
      (a) => ({
        start: new Date(a.start_at),
        end: new Date(a.end_at),
      }),
    );

    // 2) generar slots usando availability (hora Chile) -> convertir a UTC real
    const nowUTC = new Date();
    const slots: Slot[] = [];

    // Cursor día a día (usamos mediodía en Chile para evitar DST)
    let cursor = rangeStart;
    let guard = 0;

    while (cursor < rangeEnd && guard < 62) {
      guard++;

      // día local (Chile)
      const parts = getPartsInTZ(cursor, TZ);
      const noonUTC = localToUTC(parts.year, parts.month, parts.day, 12, 0, TZ);
      const dow = dayOfWeekCL(noonUTC);

      const dayBlocks = blocksByDow[dow] ?? [];

      // ✅ FIX CLAVE: si no hay bloques para ese día → no hay slots
      if (dayBlocks.length === 0) {
        // avanzar al siguiente día (mediodía Chile)
        cursor = localToUTC(parts.year, parts.month, parts.day + 1, 12, 0, TZ);
        continue;
      }

      // Para cada bloque del día, generar slots
      for (const b of dayBlocks) {
        const { hh: sh, mm: sm } = parseTimeHHMM(b.start_time);
        const { hh: eh, mm: em } = parseTimeHHMM(b.end_time);

        const blockStartUTC = localToUTC(parts.year, parts.month, parts.day, sh, sm, TZ);
        const blockEndUTC = localToUTC(parts.year, parts.month, parts.day, eh, em, TZ);

        // si bloque inválido, lo saltamos
        if (!(blockStartUTC < blockEndUTC)) continue;

        // limitar bloque al rango solicitado
        const effectiveStart = blockStartUTC < rangeStart ? rangeStart : blockStartUTC;
        const effectiveEnd = blockEndUTC > rangeEnd ? rangeEnd : blockEndUTC;

        let slotCursor = ceilToStepUTC(effectiveStart, stepMinutes);

        while (slotCursor < effectiveEnd) {
          const slotStart = slotCursor;
          const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

          // el slot debe caber completo dentro del bloque efectivo
          if (slotEnd > effectiveEnd) break;

          // no mostrar en pasado
          if (slotEnd <= nowUTC) {
            slotCursor = new Date(slotCursor.getTime() + stepMinutes * 60 * 1000);
            continue;
          }

          // validar traslape contra citas ya tomadas
          const isBusy = booked.some((br) => overlaps(slotStart, slotEnd, br.start, br.end));

          if (!isBusy) {
            slots.push({ start_at: slotStart.toISOString(), end_at: slotEnd.toISOString() });
          }

          slotCursor = new Date(slotCursor.getTime() + stepMinutes * 60 * 1000);
        }
      }

      // avanzar 1 día (mediodía Chile para evitar DST)
      cursor = localToUTC(parts.year, parts.month, parts.day + 1, 12, 0, TZ);
    }

    // Orden final por start_at
    slots.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));

    return NextResponse.json({ tenantId, professionalId, from, to, slots });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
