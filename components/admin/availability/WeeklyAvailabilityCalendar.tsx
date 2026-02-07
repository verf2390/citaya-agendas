"use client";

import React, { useEffect, useMemo, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import type { DateSelectArg, EventClickArg } from "@fullcalendar/core";

type Block = {
  id?: string;
  tempId?: string;
  day_of_week: number; // 0-6 (0=Domingo)
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  is_active: boolean;
};

type Props = {
  weekDate: Date; // controlado desde afuera
  blocks: Block[];
  onChangeBlocks: (next: Block[]) => void;
  slotMinTime?: string;
  slotMaxTime?: string;
  timeZone?: string;
};

const TZ_DEFAULT = "America/Santiago";

/**
 * Helpers robustos: NO depender de Date/TZ para guardar.
 * Tomamos startStr/endStr que FullCalendar genera según su vista/timeZone.
 */
function hhmmFromStartStr(s: string) {
  const t = s.split("T")[1] ?? "";
  return t.slice(0, 5); // "HH:MM"
}

/**
 * ✅ FIX: calcular day_of_week en LOCAL (coherente con FullCalendar timeZone)
 * Usar UTC aquí puede provocar desface 1 día en edgecases.
 */
function dowFromStartStr(s: string) {
  const d = (s.split("T")[0] ?? "").trim(); // "YYYY-MM-DD"
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y || 1970, (m || 1) - 1, day || 1, 12, 0, 0, 0); // ancla mediodía
  return dt.getDay(); // 0..6 (Dom=0)
}

/** Ancla de semana a mediodía para evitar edgecases DST */
function startOfWeekMonday(date: Date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7; // lunes => 0
  d.setDate(d.getDate() - diff);
  return d;
}

function weekKey(date: Date) {
  const m = startOfWeekMonday(date);
  const yyyy = m.getFullYear();
  const mm = String(m.getMonth() + 1).padStart(2, "0");
  const dd = String(m.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateForDowInWeek(weekDate: Date, dow: number) {
  const monday = startOfWeekMonday(weekDate);
  const offset = dow === 0 ? 6 : dow - 1; // dom->6, lun->0...
  const d = new Date(monday);
  d.setDate(monday.getDate() + offset);
  return d;
}

function mergeDateAndTime(baseDate: Date, hhmm: string) {
  const [hh, mm] = (hhmm || "00:00").slice(0, 5).split(":").map(Number);
  const d = new Date(baseDate);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

function normalizeBlock(b: Block): Block {
  return {
    ...b,
    start_time: String(b.start_time || "").slice(0, 5),
    end_time: String(b.end_time || "").slice(0, 5),
    day_of_week: Number(b.day_of_week),
    is_active: !!b.is_active,
  };
}

/** Key estable para mapear eventos <-> blocks */
function blockKey(b: Block) {
  // preferimos id > tempId > fallback determinístico
  return (
    b.id ??
    b.tempId ??
    `${b.day_of_week}|${String(b.start_time).slice(0, 5)}|${String(b.end_time).slice(0, 5)}`
  );
}

// ISO local sin "Z" (para render consistente en FullCalendar)
function toLocalIsoNoZ(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// Overlap (para bloquear solapes en UI y evitar 400)
function hhmmToMin(hhmm: string) {
  const [h, m] = (hhmm || "00:00").slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function overlaps(a: Block, b: Block) {
  if (a.day_of_week !== b.day_of_week) return false;
  const a0 = hhmmToMin(a.start_time);
  const a1 = hhmmToMin(a.end_time);
  const b0 = hhmmToMin(b.start_time);
  const b1 = hhmmToMin(b.end_time);
  return Math.max(a0, b0) < Math.min(a1, b1);
}

/**
 * Dedupe SOLO de activos, pero sin perder inactivos.
 * CLAVE para borrar (is_active=false) sin que “desaparezca” del payload a guardar.
 */
function dedupePreservingInactive(list: Block[]) {
  const inactive: Block[] = [];
  const activeMap = new Map<string, Block>();

  for (const b0 of list) {
    const b = normalizeBlock(b0);

    if (!b.is_active) {
      inactive.push(b);
      continue;
    }

    // Dedupe por “mismo slot exacto” (solo en activos)
    const k = `${b.day_of_week}|${b.start_time}|${b.end_time}`;
    const prev = activeMap.get(k);

    if (!prev) activeMap.set(k, b);
    else {
      // Preferimos el que tiene id (persistido)
      if (!prev.id && b.id) activeMap.set(k, b);
    }
  }

  return [...inactive, ...Array.from(activeMap.values())];
}

function safeUUID() {
  try {
    // @ts-ignore
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type AnyDropResizeArg = {
  event: {
    startStr?: string;
    endStr?: string;
    extendedProps?: any;
  };
  revert?: () => void;
};

export default function WeeklyAvailabilityCalendar({
  weekDate,
  blocks,
  onChangeBlocks,
  slotMinTime = "07:00:00",
  slotMaxTime = "21:00:00",
  timeZone = TZ_DEFAULT,
}: Props) {
  const calRef = useRef<FullCalendar | null>(null);

  // ✅ Sincroniza navegación semanal (evita loop)
  useEffect(() => {
    const api = calRef.current?.getApi();
    if (!api) return;

    const targetMonday = startOfWeekMonday(weekDate);
    const currentMonday = startOfWeekMonday(api.getDate());

    if (weekKey(targetMonday) === weekKey(currentMonday)) return;
    api.gotoDate(targetMonday);
  }, [weekDate]);

  const normalizedBlocks = useMemo(() => blocks.map(normalizeBlock), [blocks]);

  // Render: pintamos desde blocks (HH:MM) -> fechas de la semana
  const events = useMemo(() => {
    return normalizedBlocks
      .filter((b) => b.is_active)
      .map((b) => {
        const base = dateForDowInWeek(weekDate, b.day_of_week);
        const start = mergeDateAndTime(base, b.start_time);
        const end = mergeDateAndTime(base, b.end_time);

        const key = blockKey(b);

        return {
          id: key,
          start: toLocalIsoNoZ(start),
          end: toLocalIsoNoZ(end),
          title: "",
          classNames: ["avail-block"],
          extendedProps: { blockKey: key },
        };
      });
  }, [normalizedBlocks, weekDate]);

  // Guardado robusto: FullCalendar -> startStr/endStr -> Block (HH:MM + DOW)
  function eventToBlockFromStr(
    startStr: string,
    endStr: string,
    existing?: Block,
  ): Block {
    const ensuredTempId = existing?.tempId ?? existing?.id ?? safeUUID();

    return normalizeBlock({
      ...(existing ?? {}),
      day_of_week: dowFromStartStr(startStr),
      start_time: hhmmFromStartStr(startStr),
      end_time: hhmmFromStartStr(endStr),
      is_active: true,
      tempId: ensuredTempId,
    });
  }

  function wouldOverlap(candidate: Block, ignoreKey?: string) {
    return normalizedBlocks
      .filter((b) => b.is_active)
      .filter((b) => blockKey(b) !== ignoreKey)
      .some((b) => overlaps(b, candidate));
  }

  const onSelect = (arg: DateSelectArg) => {
    if (!arg.startStr || !arg.endStr) return;

    const candidate = eventToBlockFromStr(arg.startStr, arg.endStr);

    // Evita bloques demasiado pequeños
    if (hhmmToMin(candidate.end_time) - hhmmToMin(candidate.start_time) < 15) return;

    // 🚫 No permitir solapes
    if (wouldOverlap(candidate)) {
      alert("Ese bloque se cruza con otro horario. Ajusta la selección.");
      return;
    }

    const next = dedupePreservingInactive([...normalizedBlocks, candidate]);
    onChangeBlocks(next);
  };

  const updateFromEvent = (arg: AnyDropResizeArg) => {
    const startStr = arg?.event?.startStr;
    const endStr = arg?.event?.endStr;
    if (!startStr || !endStr) return;

    const key = arg?.event?.extendedProps?.blockKey as string | undefined;
    if (!key) return;

    const idx = normalizedBlocks.findIndex((b) => blockKey(b) === key);
    if (idx === -1) return;

    const updated = eventToBlockFromStr(startStr, endStr, normalizedBlocks[idx]);

    if (wouldOverlap(updated, key)) {
      alert("Ese cambio cruza con otro horario. Ajusta el bloque.");
      arg.revert?.();
      return;
    }

    const next = normalizedBlocks.slice();
    next[idx] = updated;
    onChangeBlocks(dedupePreservingInactive(next));
  };

  /**
   * ✅ Click para quitar/borrar bloque.
   * - No lo eliminamos del array: lo marcamos is_active=false
   * - Así el guardado puede desactivar/borrar en DB.
   */
  const onEventClick = (arg: EventClickArg) => {
    const key = (arg.event.extendedProps as any)?.blockKey as string | undefined;
    if (!key) return;

    const idx = normalizedBlocks.findIndex((b) => blockKey(b) === key);
    if (idx === -1) return;

    const ok = confirm("¿Quitar este horario?");
    if (!ok) return;

    const next = normalizedBlocks.slice();
    next[idx] = { ...next[idx], is_active: false };

    onChangeBlocks(dedupePreservingInactive(next));
  };

  return (
    <div className="rounded-xl border bg-white p-2">
      <style>{`
        .avail-block {
          background: rgba(34, 197, 94, 0.25) !important;
          border: 1px solid rgba(34, 197, 94, 0.55) !important;
          border-radius: 12px !important;
          cursor: pointer !important;
        }
      `}</style>

      <FullCalendar
        ref={calRef}
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        initialDate={startOfWeekMonday(weekDate)}
        timeZone={timeZone}
        locale={esLocale}
        firstDay={1}
        headerToolbar={false}
        allDaySlot={false}
        selectable
        editable
        events={events}
        select={onSelect}
        eventDrop={updateFromEvent as any}
        eventResize={updateFromEvent as any}
        eventClick={onEventClick}
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        height="auto"
      />
    </div>
  );
}
