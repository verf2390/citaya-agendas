"use client";

import { useMemo } from "react";
import type React from "react";
import { ChevronLeft, ChevronRight, CalendarPlus } from "lucide-react";

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
  const name = tenantName?.trim() ? tenantName : "Tu negocio";
  const logo = tenantLogoUrl?.trim() || null;

  return (
    <div className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-4 py-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          {/* IZQUIERDA */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {logo ? (
                <img
                  src={logo}
                  alt={`Logo ${name}`}
                  className="h-7 w-7 rounded-md border bg-white object-contain p-1"
                  loading="lazy"
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

            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
              <h1 className="truncate text-lg font-semibold">{name}</h1>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="truncate text-sm capitalize text-muted-foreground">
                {prettyDate}
              </span>
            </div>

            {subSlot ? (
              <div className="mt-2 flex flex-wrap gap-2">{subSlot}</div>
            ) : null}
          </div>

          {/* DERECHA */}
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {/* Navegación + CTA */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onPrevDay}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-white hover:bg-muted"
                aria-label="Día anterior"
                title="Día anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onToday}
                className="inline-flex h-9 items-center justify-center rounded-md border bg-white px-3 text-sm font-medium hover:bg-muted"
                title="Ir a hoy"
              >
                Hoy
              </button>

              <button
                type="button"
                onClick={onNextDay}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-white hover:bg-muted"
                aria-label="Día siguiente"
                title="Día siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onNewAppointment}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:opacity-90"
                title="Crear nueva cita"
              >
                <CalendarPlus className="h-4 w-4" />
                Nueva cita
              </button>
            </div>

            {/* Clientes / Cerrar sesión */}
            {rightSlot ? (
              <div className="flex flex-wrap items-center gap-2">
                {rightSlot}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
