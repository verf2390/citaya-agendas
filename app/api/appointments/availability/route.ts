// app/api/appointments/availability/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type AppointmentRangeRow = {
  start_at: string;
  end_at: string;
  status: string | null;
};

type BookedRange = { start: Date; end: Date };
type Slot = { start_at: string; end_at: string };

const TZ = "America/Santiago";

/**
 * MVP: Horario laboral fijo (hora Chile)
 * Lunes a Viernes: 09:00 - 18:00
 * Sábado: 10:00 - 14:00
 * Domingo: cerrado
 */
function getWorkingHoursLocal(dayOfWeek: number) {
  // 0=Dom, 1=Lun, ... 6=Sab
  if (dayOfWeek === 0) return null;
  if (dayOfWeek === 6) return { startHour: 10, endHour: 14 };
  return { startHour: 9, endHour: 18 };
}

/**
 * Devuelve parts (año/mes/día/hora/min) de una fecha en una timezone.
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
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";

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
 * Truco estándar: compara "fecha UTC" vs "misma fecha interpretada como UTC a partir de parts en TZ".
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
  timeZone: string
) {
  // 1) primer guess: tratar el wall time como si fuera UTC
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  // 2) calcular offset en esa TZ y corregir
  let offset = getTimeZoneOffsetMinutes(guess, timeZone);
  let utc = new Date(guess.getTime() + offset * 60000);

  // 3) segunda pasada (mejor en cambios DST)
  offset = getTimeZoneOffsetMinutes(utc, timeZone);
  utc = new Date(guess.getTime() + offset * 60000);

  return utc;
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

    if (!tenantId || !professionalId || !from || !to) {
      return NextResponse.json(
        { error: "Faltan parámetros: tenantId, professionalId, from, to" },
        { status: 400 }
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
        { status: 400 }
      );
    }

    // 1) traer citas existentes (bloquean slots) - filtramos por tenant+profesional
    const { data: appts, error } = await supabaseServer
      .from("appointments")
      .select("start_at,end_at,status")
      .eq("tenant_id", tenantId)
      .eq("professional_id", professionalId)
      .neq("status", "canceled")
      .lt("start_at", rangeEnd.toISOString())
      .gt("end_at", rangeStart.toISOString());

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Error consultando citas" }, { status: 500 });
    }

    const booked: BookedRange[] = ((appts ?? []) as AppointmentRangeRow[]).map((a) => ({
      start: new Date(a.start_at),
      end: new Date(a.end_at),
    }));

    // 2) generar slots (hora Chile) -> convertir a UTC real
    const stepMinutes = 30;
    const durationMinutes = 30;
    const nowUTC = new Date();

    const slots: Slot[] = [];

    // Vamos día a día según calendario Chile:
    // Tomamos el "día local" de rangeStart y avanzamos de a 1 día.
    let cursor = rangeStart;

    // Para evitar loops infinitos, limitamos a 31 días (MVP seguro)
    let guard = 0;

    while (cursor < rangeEnd && guard < 31) {
      guard++;

      const parts = getPartsInTZ(cursor, TZ);
      const dayOfWeek = new Date(
        localToUTC(parts.year, parts.month, parts.day, 12, 0, TZ) // mediodía local
      ).getUTCDay(); // UTCDay del instante, pero ojo: usamos mediodía local para que caiga en el día correcto
      // Mejor: calcular día de semana local desde "cursor" en TZ:
      // (lo hacemos simple: usamos parts y una fecha UTC del mediodía local)
      const hours = getWorkingHoursLocal(dayOfWeek);

      if (hours) {
        // inicio/fin del día laboral en hora Chile -> UTC
        const dayStartUTC = localToUTC(parts.year, parts.month, parts.day, hours.startHour, 0, TZ);
        const dayEndUTC = localToUTC(parts.year, parts.month, parts.day, hours.endHour, 0, TZ);

        // limitar a rango
        const effectiveStart = dayStartUTC < rangeStart ? rangeStart : dayStartUTC;
        const effectiveEnd = dayEndUTC > rangeEnd ? rangeEnd : dayEndUTC;

        let slotCursor = ceilToStepUTC(effectiveStart, stepMinutes);

        while (slotCursor < effectiveEnd) {
          const slotStart = slotCursor;
          const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

          // no mostrar en pasado
          if (slotEnd <= nowUTC) {
            slotCursor = new Date(slotCursor.getTime() + stepMinutes * 60 * 1000);
            continue;
          }

          // validar rango
          if (slotStart >= rangeEnd || slotEnd <= rangeStart) {
            slotCursor = new Date(slotCursor.getTime() + stepMinutes * 60 * 1000);
            continue;
          }

          // validar traslape contra citas ya tomadas
          const isBusy = booked.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));

          if (!isBusy) {
            slots.push({ start_at: slotStart.toISOString(), end_at: slotEnd.toISOString() });
          }

          slotCursor = new Date(slotCursor.getTime() + stepMinutes * 60 * 1000);
        }
      }

      // avanzar 1 día: tomamos "mañana" en hora Chile a las 12:00 para evitar problemas DST
      const tomorrowNoonUTC = localToUTC(parts.year, parts.month, parts.day + 1, 12, 0, TZ);
      cursor = tomorrowNoonUTC;
    }

    return NextResponse.json({ tenantId, professionalId, from, to, slots });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
