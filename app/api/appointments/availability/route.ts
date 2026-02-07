// app/api/appointments/availability/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type AppointmentRangeRow = {
  start_at: string;
  end_at: string;
  status: string | null;
};

type AvailabilityRow = {
  day_of_week: number; // 0=domingo ... 6=sábado
  start_time: string; // "HH:MM:SS"
  end_time: string; // "HH:MM:SS"
  is_active: boolean;
};

type ServiceRuleRow = {
  day_of_week: number; // 0=domingo ... 6=sábado (guardado normalizado)
  start_time: string; // "HH:MM:SS"
  end_time: string; // "HH:MM:SS"
  is_active: boolean;
};

type BookedRange = { start: Date; end: Date };
type Slot = { start_at: string; end_at: string };

const TZ = "America/Santiago";

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

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const p = getPartsInTZ(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (date.getTime() - asUTC) / 60000;
}

function localToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  let offset = getTimeZoneOffsetMinutes(guess, timeZone);
  let utc = new Date(guess.getTime() + offset * 60000);

  offset = getTimeZoneOffsetMinutes(utc, timeZone);
  utc = new Date(guess.getTime() + offset * 60000);

  return utc;
}

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

function parseTimeHHMM(time: string) {
  const [hh, mm] = time.split(":");
  return { hh: Number(hh || 0), mm: Number(mm || 0) };
}

function ceilToStepUTC(date: Date, stepMinutes: number) {
  const stepMs = stepMinutes * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / stepMs) * stepMs);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function maxDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b;
}

function minDate(a: Date, b: Date) {
  return a.getTime() <= b.getTime() ? a : b;
}

function diffDaysCeil(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const tenantId = url.searchParams.get("tenantId");
    const professionalId = url.searchParams.get("professionalId");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    // ✅ serviceId opcional para reglas por servicio
    const serviceId = url.searchParams.get("serviceId");

    const durationMinParam = url.searchParams.get("durationMin");
    const stepMinParam = url.searchParams.get("stepMin");

    const debug = url.searchParams.get("debug") === "1";

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

    // 0) availability activos (horario base profesional)
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

    const blocksByDow: Record<number, AvailabilityRow[]> = {};
    for (const r of availability) {
      if (!blocksByDow[r.day_of_week]) blocksByDow[r.day_of_week] = [];
      blocksByDow[r.day_of_week].push(r);
    }
    Object.keys(blocksByDow).forEach((k) => {
      blocksByDow[Number(k)].sort((a, b) =>
        a.start_time > b.start_time ? 1 : -1,
      );
    });

    // 0.5) reglas por servicio — opcional
    let serviceRules: ServiceRuleRow[] = [];
    if (serviceId) {
      const { data: ruleRows, error: ruleErr } = await supabaseServer
        .from("service_availability_rules")
        .select("day_of_week,start_time,end_time,is_active")
        .eq("tenant_id", tenantId)
        .eq("professional_id", professionalId)
        .eq("service_id", serviceId)
        .eq("is_active", true);

      if (ruleErr) {
        console.error(ruleErr);
        return NextResponse.json(
          { error: "Error consultando reglas por servicio" },
          { status: 500 },
        );
      }

      serviceRules = (ruleRows ?? []) as ServiceRuleRow[];
    }

    const hasServiceRules = !!serviceId && serviceRules.length > 0;

    const rulesByDow: Record<number, ServiceRuleRow[]> = {};
    for (const r of serviceRules) {
      if (!rulesByDow[r.day_of_week]) rulesByDow[r.day_of_week] = [];
      rulesByDow[r.day_of_week].push(r);
    }
    Object.keys(rulesByDow).forEach((k) => {
      rulesByDow[Number(k)].sort((a, b) =>
        a.start_time > b.start_time ? 1 : -1,
      );
    });

    // 1) citas existentes
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

    // 2) generar slots
    const nowUTC = new Date();
    const slots: Slot[] = [];
    const slotSeen = new Set<string>(); // ✅ dedupe

    // ✅ iteración por días CL robusta
    const startParts = getPartsInTZ(rangeStart, TZ);
    const startNoonUTC = localToUTC(
      startParts.year,
      startParts.month,
      startParts.day,
      12,
      0,
      TZ,
    );

    const daysToIterate = Math.min(400, diffDaysCeil(rangeStart, rangeEnd) + 2); // guard amplio
    let y = startParts.year;
    let m = startParts.month;
    let d = startParts.day;

    const debugDays: Array<{
      y: number;
      m: number;
      d: number;
      noonUTC: string;
      dow: number;
      baseBlocksCount: number;
      rulesCount: number;
      usedMode: "base" | "base∩rules";
    }> = [];

    for (let i = 0; i < daysToIterate; i++) {
      const noonUTC = localToUTC(y, m, d, 12, 0, TZ);

      // corte real por rango
      if (noonUTC > rangeEnd) break;

      const dow = dayOfWeekCL(noonUTC);

      const dayBaseBlocks = blocksByDow[dow] ?? [];
      const dayRuleBlocks = hasServiceRules ? rulesByDow[dow] ?? [] : [];

      if (debug) {
        debugDays.push({
          y,
          m,
          d,
          noonUTC: noonUTC.toISOString(),
          dow,
          baseBlocksCount: dayBaseBlocks.length,
          rulesCount: dayRuleBlocks.length,
          usedMode: hasServiceRules ? "base∩rules" : "base",
        });
      }

      // Si no hay horario base, no hay slots
      if (dayBaseBlocks.length === 0) {
        const next = localToUTC(y, m, d + 1, 12, 0, TZ);
        const np = getPartsInTZ(next, TZ);
        y = np.year; m = np.month; d = np.day;
        continue;
      }

      // Si hay reglas y este día no tiene reglas => no hay slots
      if (hasServiceRules && dayRuleBlocks.length === 0) {
        const next = localToUTC(y, m, d + 1, 12, 0, TZ);
        const np = getPartsInTZ(next, TZ);
        y = np.year; m = np.month; d = np.day;
        continue;
      }

      const pushSlotIfFree = (slotStart: Date, slotEnd: Date) => {
        if (slotEnd <= nowUTC) return;

        const isBusy = booked.some((br) =>
          overlaps(slotStart, slotEnd, br.start, br.end),
        );
        if (isBusy) return;

        const key = `${slotStart.toISOString()}|${slotEnd.toISOString()}`;
        if (slotSeen.has(key)) return;
        slotSeen.add(key);

        slots.push({ start_at: slotStart.toISOString(), end_at: slotEnd.toISOString() });
      };

      if (!hasServiceRules) {
        for (const b of dayBaseBlocks) {
          const { hh: sh, mm: sm } = parseTimeHHMM(b.start_time);
          const { hh: eh, mm: em } = parseTimeHHMM(b.end_time);

          const blockStartUTC = localToUTC(y, m, d, sh, sm, TZ);
          const blockEndUTC = localToUTC(y, m, d, eh, em, TZ);
          if (!(blockStartUTC < blockEndUTC)) continue;

          const effectiveStart = blockStartUTC < rangeStart ? rangeStart : blockStartUTC;
          const effectiveEnd = blockEndUTC > rangeEnd ? rangeEnd : blockEndUTC;

          let slotCursor = ceilToStepUTC(effectiveStart, stepMinutes);

          while (slotCursor < effectiveEnd) {
            const slotStart = slotCursor;
            const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);
            if (slotEnd > effectiveEnd) break;

            pushSlotIfFree(slotStart, slotEnd);

            slotCursor = new Date(slotCursor.getTime() + stepMinutes * 60 * 1000);
          }
        }
      } else {
        // base ∩ rules
        for (const base of dayBaseBlocks) {
          const { hh: bsh, mm: bsm } = parseTimeHHMM(base.start_time);
          const { hh: beh, mm: bem } = parseTimeHHMM(base.end_time);

          const baseStartUTC = localToUTC(y, m, d, bsh, bsm, TZ);
          const baseEndUTC = localToUTC(y, m, d, beh, bem, TZ);
          if (!(baseStartUTC < baseEndUTC)) continue;

          for (const rule of dayRuleBlocks) {
            const { hh: rsh, mm: rsm } = parseTimeHHMM(rule.start_time);
            const { hh: reh, mm: rem } = parseTimeHHMM(rule.end_time);

            const ruleStartUTC = localToUTC(y, m, d, rsh, rsm, TZ);
            const ruleEndUTC = localToUTC(y, m, d, reh, rem, TZ);
            if (!(ruleStartUTC < ruleEndUTC)) continue;

            const interStart = maxDate(baseStartUTC, ruleStartUTC);
            const interEnd = minDate(baseEndUTC, ruleEndUTC);
            if (!(interStart < interEnd)) continue;

            const effectiveStart = interStart < rangeStart ? rangeStart : interStart;
            const effectiveEnd = interEnd > rangeEnd ? rangeEnd : interEnd;

            let slotCursor = ceilToStepUTC(effectiveStart, stepMinutes);

            while (slotCursor < effectiveEnd) {
              const slotStart = slotCursor;
              const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);
              if (slotEnd > effectiveEnd) break;

              pushSlotIfFree(slotStart, slotEnd);

              slotCursor = new Date(slotCursor.getTime() + stepMinutes * 60 * 1000);
            }
          }
        }
      }

      // avanzar 1 día CL (mediodía)
      const next = localToUTC(y, m, d + 1, 12, 0, TZ);
      const np = getPartsInTZ(next, TZ);
      y = np.year; m = np.month; d = np.day;
    }

    slots.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));

    return NextResponse.json({
      tenantId,
      professionalId,
      serviceId: serviceId || null,
      from,
      to,
      slots,
      ...(debug
        ? {
            debug: {
              durationMinutes,
              stepMinutes,
              rangeStart: rangeStart.toISOString(),
              rangeEnd: rangeEnd.toISOString(),
              availabilityRows: availability,
              hasServiceRules,
              serviceRulesRows: serviceRules,
              bookedCount: booked.length,
              days: debugDays,
            },
          }
        : {}),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
