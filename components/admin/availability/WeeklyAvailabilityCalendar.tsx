"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import type { DateSelectArg, DatesSetArg } from "@fullcalendar/core";



type Block = {
  id?: string;            // si viene de DB
  tempId?: string;        // si es nuevo
  day_of_week: number;    // 0-6
  start_time: string;     // "HH:MM"
  end_time: string;       // "HH:MM"
  is_active: boolean;
};

type Props = {
  /** semana que debe mostrar (controlada desde afuera) */
  weekDate: Date;

  /** blocks actuales del profesional (por día) */
  blocks: Block[];

  /** cuando cambia la semana por navegación interna del calendario */
  onWeekChange?: (d: Date) => void;

  /** cuando el usuario crea/mueve/resize un bloque (te entrego blocks normalizados) */
  onChangeBlocks: (next: Block[]) => void;

  slotMinTime?: string;
  slotMaxTime?: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toHHMM(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function startOfWeekMonday(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 dom ... 6 sab
  const diff = (day === 0 ? -6 : 1) - day; // monday as first day
  d.setDate(d.getDate() + diff);
  return d;
}

/** Devuelve la fecha real (YYYY-MM-DD) de un day_of_week dentro de la semana visible */
function dateForDowInWeek(weekDate: Date, dow: number) {
  const monday = startOfWeekMonday(weekDate);
  // FullCalendar dow: 0=domingo. Queremos que lunes sea monday+0.
  // Convertimos dow (0 dom..6 sab) a offset desde lunes:
  const offset =
    dow === 0 ? 6 : dow - 1; // dom -> +6, lun -> +0, mar -> +1 ...
  const d = new Date(monday);
  d.setDate(monday.getDate() + offset);
  return d;
}

function mergeDateAndTime(baseDate: Date, hhmm: string) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const d = new Date(baseDate);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

function normalizeBlock(b: Block): Block {
  const s = (b.start_time || "").slice(0, 5);
  const e = (b.end_time || "").slice(0, 5);
  return { ...b, start_time: s, end_time: e, is_active: !!b.is_active };
}

export default function WeeklyAvailabilityCalendar({
  weekDate,
  blocks,
  onWeekChange,
  onChangeBlocks,
  slotMinTime = "07:00:00",
  slotMaxTime = "21:00:00",
}: Props) {
  const calRef = useRef<FullCalendar | null>(null);

  // 1) Forzar que el calendario vaya a weekDate cuando weekDate cambie
  useEffect(() => {
    const api = calRef.current?.getApi();
    if (!api) return;
    api.gotoDate(weekDate);
  }, [weekDate]);

  const normalizedBlocks = useMemo(() => blocks.map(normalizeBlock), [blocks]);

  // 2) Convertir blocks (por día) -> eventos visibles en la semana actual
  const events = useMemo(() => {
    return normalizedBlocks
      .filter((b) => b.is_active)
      .map((b) => {
        const base = dateForDowInWeek(weekDate, b.day_of_week);
        const start = mergeDateAndTime(base, b.start_time);
        const end = mergeDateAndTime(base, b.end_time);

        const id = b.id ?? b.tempId ?? crypto.randomUUID();

        return {
          id,
          start: start.toISOString(),
          end: end.toISOString(),
          title: "",
          classNames: ["avail-block"],
          extendedProps: { blockKey: b.id ?? b.tempId ?? id },
        };
      });
  }, [normalizedBlocks, weekDate]);

  // 3) Ayuda: convertir un evento (start/end reales) -> Block(day_of_week + HH:MM)
  function eventToBlock(start: Date, end: Date, existing?: Block): Block {
    const dow = start.getDay(); // 0..6
    return normalizeBlock({
      ...(existing ?? {}),
      day_of_week: dow,
      start_time: toHHMM(start),
      end_time: toHHMM(end),
      is_active: true,
      // si no tenía id real, aseguramos tempId estable
      tempId: existing?.tempId ?? existing?.id ?? crypto.randomUUID(),
    });
  }

  // 4) Crear bloque por selección
  const onSelect = (arg: DateSelectArg) => {
    const start = arg.start;
    const end = arg.end;
    if (!start || !end) return;

    // evitar bloques minúsculos
    if (end.getTime() - start.getTime() < 15 * 60 * 1000) return;

    const next = [...normalizedBlocks, eventToBlock(start, end)];
    onChangeBlocks(next);
  };

  // 5) Mover bloque (drag)
  const onDrop = (arg: any) => {

    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return;

    const key = (arg.event.extendedProps as any)?.blockKey as string | undefined;
    const idx = normalizedBlocks.findIndex((b) => (b.id ?? b.tempId) === key);
    if (idx === -1) return;

    const updated = eventToBlock(start, end, normalizedBlocks[idx]);
    const next = normalizedBlocks.slice();
    next[idx] = updated;
    onChangeBlocks(next);
  };

  // 6) Resize bloque
  const onResize = (arg: any) => {


    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return;

    const key = (arg.event.extendedProps as any)?.blockKey as string | undefined;
    const idx = normalizedBlocks.findIndex((b) => (b.id ?? b.tempId) === key);
    if (idx === -1) return;

    const updated = eventToBlock(start, end, normalizedBlocks[idx]);
    const next = normalizedBlocks.slice();
    next[idx] = updated;
    onChangeBlocks(next);
  };

  // 7) Cambios de semana dentro del calendario
  const onDatesSet = (arg: DatesSetArg) => {
    // tomamos el start del rango visible para setear semana
    onWeekChange?.(arg.start);
  };

  return (
    <div className="rounded-xl border bg-white p-2">
      <style>{`
        .avail-block {
          background: rgba(34, 197, 94, 0.25) !important;
          border: 1px solid rgba(34, 197, 94, 0.55) !important;
          border-radius: 12px !important;
        }
        .fc .fc-timegrid-slot { height: 2.1em; }
        .fc .fc-timegrid-axis { width: 56px; }
        .fc .fc-timegrid-now-indicator-line { border-top-width: 2px; }
      `}</style>

      <FullCalendar
        ref={calRef}
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        initialDate={weekDate}
        locale={esLocale}
        firstDay={1}
        headerToolbar={false}
        allDaySlot={false}
        nowIndicator
        selectable
        selectMirror
        selectOverlap={true}
        editable
        eventStartEditable
        eventDurationEditable
        eventResizableFromStart
        events={events}
        select={onSelect}
        eventDrop={onDrop}
        eventResize={onResize}
        datesSet={onDatesSet}
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        height="auto"
        contentHeight={720}
      />
    </div>
  );
}
