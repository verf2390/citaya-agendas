"use client";

import React, { useEffect, useMemo, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import type { DateSelectArg } from "@fullcalendar/core";

type Block = {
  id?: string;
  tempId?: string;
  day_of_week: number; // 0-6 (JS getDay)
  start_time: string;  // "HH:MM"
  end_time: string;    // "HH:MM"
  is_active: boolean;
};

type Props = {
  weekDate: Date;                 // controlado desde afuera
  blocks: Block[];
  onChangeBlocks: (next: Block[]) => void;
  slotMinTime?: string;
  slotMaxTime?: string;
  timeZone?: string;
};

/* Helpers */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toHHMM(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function startOfWeekMonday(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
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

export default function WeeklyAvailabilityCalendar({
  weekDate,
  blocks,
  onChangeBlocks,
  slotMinTime = "07:00:00",
  slotMaxTime = "21:00:00",
  timeZone,
}: Props) {
  const calRef = useRef<FullCalendar | null>(null);

  // ✅ Solo sincronizamos hacia el calendario interno (controlado por props)
  useEffect(() => {
  const api = calRef.current?.getApi();
  if (!api) return;

  const targetMonday = startOfWeekMonday(weekDate);
  const currentMonday = startOfWeekMonday(api.getDate());

  console.log("[AVAIL] weekDate:", weekDate.toString(), "key:", weekKey(weekDate));
  console.log("[AVAIL] targetMonday:", targetMonday.toString(), "key:", weekKey(targetMonday));
  console.log("[AVAIL] api.getDate():", api.getDate().toString(), "key:", weekKey(api.getDate()));

  if (weekKey(targetMonday) === weekKey(currentMonday)) return;
  api.gotoDate(targetMonday);
}, [weekDate]);


  const normalizedBlocks = useMemo(() => blocks.map(normalizeBlock), [blocks]);

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
          start, // Date (NO ISO)
          end,   // Date (NO ISO)
          title: "",
          classNames: ["avail-block"],
          extendedProps: { blockKey: b.id ?? b.tempId ?? id },
        };
      });
  }, [normalizedBlocks, weekDate]);

  function eventToBlock(start: Date, end: Date, existing?: Block): Block {
    return normalizeBlock({
      ...(existing ?? {}),
      day_of_week: start.getDay(),
      start_time: toHHMM(start),
      end_time: toHHMM(end),
      is_active: true,
      tempId: existing?.tempId ?? existing?.id ?? crypto.randomUUID(),
    });
  }

  const onSelect = (arg: DateSelectArg) => {
    const start = arg.start;
    const end = arg.end;
    if (!start || !end) return;

    if (end.getTime() - start.getTime() < 15 * 60 * 1000) return;

    onChangeBlocks([...normalizedBlocks, eventToBlock(start, end)]);
  };

  const updateFromEvent = (arg: any) => {
    const start = arg.event.start as Date | null;
    const end = arg.event.end as Date | null;
    if (!start || !end) return;

    const key = arg.event.extendedProps?.blockKey as string | undefined;
    const idx = normalizedBlocks.findIndex((b) => (b.id ?? b.tempId) === key);
    if (idx === -1) return;

    const next = normalizedBlocks.slice();
    next[idx] = eventToBlock(start, end, normalizedBlocks[idx]);
    onChangeBlocks(next);
  };

  return (
    <div className="rounded-xl border bg-white p-2">
      <style>{`
        .avail-block {
          background: rgba(34, 197, 94, 0.25) !important;
          border: 1px solid rgba(34, 197, 94, 0.55) !important;
          border-radius: 12px !important;
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
        eventDrop={updateFromEvent}
        eventResize={updateFromEvent}
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        height="auto"
      />
    </div>
  );
}
