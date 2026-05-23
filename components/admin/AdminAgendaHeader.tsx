"use client";

import Image from "next/image";
import { useMemo } from "react";
import type React from "react";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type Props = {
  tenantName?: string | null;
  tenantLogoUrl?: string | null; // ✅ NUEVO
  date?: Date;

  onToday?: () => void;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onNewAppointment?: () => void;

  // Botones externos (Clientes / Cerrar sesión)
  rightSlot?: React.ReactNode;

  // Badges debajo del título
  subSlot?: React.ReactNode;
};

const fmtDay = (d?: Date) => {
  if (!d) return "Hoy";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(d);
};

const getMondayStart = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diffToMonday = (day + 6) % 7;
  x.setDate(x.getDate() - diffToMonday);
  return x;
};

const fmtWeekRange = (d?: Date) => {
  if (!d) return "Semana actual";

  const start = getMondayStart(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const dayFmt = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
  });
  const monthFmt = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    month: "long",
  });

  const startDay = dayFmt.format(start);
  const endDay = dayFmt.format(end);
  const startMonth = monthFmt.format(start);
  const endMonth = monthFmt.format(end);

  if (startMonth === endMonth) {
    return `Semana del ${startDay} al ${endDay} de ${endMonth}`;
  }

  return `Semana del ${startDay} de ${startMonth} al ${endDay} de ${endMonth}`;
};

export default function AdminAgendaHeader({
  tenantName,
  tenantLogoUrl,
  date,
  onToday,
  onPrevDay,
  onNextDay,
  onNewAppointment,
  rightSlot,
  subSlot,
}: Props) {
  const prettyDate = useMemo(() => fmtDay(date), [date]);
  const weekRange = useMemo(() => fmtWeekRange(date), [date]);
  const name = tenantName?.trim() ? tenantName : "Tu negocio";
  const logo = tenantLogoUrl?.trim() || null;

  return (
    <div className="sticky top-0 z-30 max-w-full overflow-hidden border-b bg-background/90 backdrop-blur">
      <div className="mx-auto max-w-[1280px] px-3 py-3 sm:px-4 lg:ml-72 lg:mr-6">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          {/* IZQUIERDA */}
          <div className="min-w-0 max-w-full">
            <div className="flex items-center gap-2">
              {logo ? (
                <Image
                  src={logo}
                  alt={`Logo ${name}`}
                  width={28}
                  height={28}
                  unoptimized
                  className="h-7 w-7 rounded-md border bg-white object-contain p-1"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // si falla el logo, lo ocultamos sin romper layout
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : null}

              <div className="text-xs font-semibold text-muted-foreground">
                Agenda
              </div>
            </div>

            <div className="mt-1 flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-2">
              <h1 className="min-w-0 break-words text-xl font-semibold leading-tight sm:truncate sm:text-lg">{name}</h1>
              <span className="hidden text-xs text-muted-foreground sm:inline">•</span>
              <span className="min-w-0 text-sm capitalize leading-snug text-muted-foreground sm:truncate">
                {weekRange}
              </span>
            </div>
            <div className="mt-0.5 text-xs capitalize text-muted-foreground">
              Inicia: {prettyDate}
            </div>

            {subSlot ? (
              <div className="mt-2 flex min-w-0 max-w-full flex-wrap gap-2">{subSlot}</div>
            ) : null}
          </div>

          {/* DERECHA */}
          <div className="flex w-full min-w-0 flex-col items-stretch gap-2 lg:w-auto lg:items-end">
            {/* Navegación + CTA */}
            <div className="grid w-full grid-cols-[44px_minmax(0,1fr)_44px] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={onPrevDay}
                className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl border bg-white px-2.5 text-sm font-medium hover:bg-muted sm:h-9 sm:px-3"
                aria-label="Semana anterior"
                title="Semana anterior"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Semana anterior</span>
              </button>

              <button
                type="button"
                onClick={onToday}
                className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-medium hover:bg-muted sm:h-9"
                title="Volver a semana actual"
              >
                <CalendarDays className="h-4 w-4" />
                <span>Hoy</span>
              </button>

              <button
                type="button"
                onClick={onNextDay}
                className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl border bg-white px-2.5 text-sm font-medium hover:bg-muted sm:h-9 sm:px-3"
                aria-label="Semana siguiente"
                title="Semana siguiente"
              >
                <span className="hidden sm:inline">Semana siguiente</span>
                <ChevronRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onNewAppointment}
                className="col-span-3 inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl bg-black px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 sm:col-span-auto sm:h-9"
                title="Crear nueva cita"
              >
                <CalendarPlus className="h-4 w-4" />
                Nueva cita
              </button>
            </div>

            {/* Clientes / Cerrar sesión */}
            {rightSlot ? (
              <div className="flex w-full min-w-0 flex-wrap items-center gap-2 [&>button]:h-10 [&>button]:w-full [&>button]:rounded-xl sm:w-auto sm:[&>button]:w-auto">
                {rightSlot}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
