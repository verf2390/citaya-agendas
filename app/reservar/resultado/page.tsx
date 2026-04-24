"use client";

import Link from "next/link";
import React, { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";

const tz = "America/Santiago";

function parseTimestamptz(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return new Date(NaN);
  const s = raw.includes(" ") ? raw.replace(" ", "T") : raw;
  return new Date(s);
}

const fmtLongDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(parseTimestamptz(iso));

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(parseTimestamptz(iso));

const fmtDateTimeShort = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parseTimestamptz(iso));

function StatusPill({ status }: { status: string }) {
  const s = (status || "").toLowerCase();

  const meta =
    s === "canceled"
      ? {
          label: "Cancelada",
          cls: "bg-red-50 text-red-700 border-red-200",
          icon: "🛑",
        }
      : s === "rescheduled"
        ? {
            label: "Reagendada",
            cls: "bg-amber-50 text-amber-800 border-amber-200",
            icon: "📅",
          }
        : {
            label: "Listo",
            cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
            icon: "✅",
          };

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-extrabold ${meta.cls}`}>
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function ResultInner() {
  const sp = useSearchParams();
  const status = (sp.get("status") || "").toLowerCase();
  const start = sp.get("start");
  const end = sp.get("end");

  const isRescheduled = status === "rescheduled";
  const isCanceled = status === "canceled";
  const isPaymentSuccess = status === "success";
  const isPaymentFailure = status === "failure";
  const isPaymentPending = status === "pending";

  const title = isRescheduled
    ? "¡Listo! Tu cita ha sido reagendada"
    : isCanceled
      ? "Listo: tu cita ha sido cancelada"
      : isPaymentSuccess
        ? "Pago recibido"
        : isPaymentPending
          ? "Pago pendiente"
          : isPaymentFailure
            ? "No se pudo completar el pago"
            : "Listo";

  const subtitle = isRescheduled
    ? "Te dejamos el nuevo horario abajo. Si necesitas revisar el detalle, puedes volver a reservar o abrir tu enlace privado."
    : isCanceled
      ? "Si quieres, puedes reservar una nueva hora cuando quieras."
      : isPaymentSuccess
        ? "Tu pago fue enviado correctamente. El estado final se confirma por webhook."
        : isPaymentPending
          ? "Mercado Pago dejó la operación pendiente. Revisa luego el estado final de la cita."
          : isPaymentFailure
            ? "Puedes intentar nuevamente desde el flujo de pago de la cita."
            : "Acción completada.";

  const whenLabel = useMemo(() => {
    if (!isRescheduled || !start) return null;
    try {
      return `${fmtLongDate(start)} · ${fmtTime(start)}`;
    } catch {
      return fmtDateTimeShort(start);
    }
  }, [isRescheduled, start]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>
                <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
              </div>

              <div className="flex flex-col items-end gap-2">
                <StatusPill status={status} />
                {whenLabel ? <div className="text-[11px] text-slate-500">🕒 {whenLabel}</div> : null}
              </div>
            </div>

            {isRescheduled ? (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div className="text-sm font-extrabold text-slate-900">Nuevo horario</div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white border border-slate-200 p-4">
                    <div className="text-xs font-semibold text-slate-500">Nuevo inicio</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{start ? fmtLongDate(start) : "—"}</div>
                    <div className="mt-1 text-sm text-slate-800">{start ? `🕒 ${fmtTime(start)}` : "—"}</div>
                    <div className="mt-2 text-xs text-slate-500">{start ? fmtDateTimeShort(start) : ""}</div>
                  </div>

                  <div className="rounded-xl bg-white border border-slate-200 p-4">
                    <div className="text-xs font-semibold text-slate-500">Nuevo fin</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{end ? fmtLongDate(end) : "—"}</div>
                    <div className="mt-1 text-sm text-slate-800">{end ? `🕒 ${fmtTime(end)}` : "—"}</div>
                    <div className="mt-2 text-xs text-slate-500">{end ? fmtDateTimeShort(end) : ""}</div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  💡 Te recomendamos llegar <b>5 minutos antes</b>.
                </div>
              </div>
            ) : null}

            {isCanceled ? (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div className="text-sm font-extrabold text-slate-900">Cancelación confirmada</div>
                <div className="mt-2 text-sm text-slate-700">
                  Si necesitas una nueva hora, puedes reservar de nuevo cuando quieras.
                </div>
              </div>
            ) : null}

            {(isPaymentSuccess || isPaymentPending || isPaymentFailure) ? (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div className="text-sm font-extrabold text-slate-900">Estado del pago</div>
                <div className="mt-2 text-sm text-slate-700">
                  {isPaymentSuccess
                    ? "El checkout volvió correctamente. Aun así, el backend toma como fuente de verdad el webhook de Mercado Pago."
                    : isPaymentPending
                      ? "La operación quedó pendiente en Mercado Pago. No marques la cita como pagada hasta recibir el webhook."
                      : "El pago falló o fue rechazado. La cita debería seguir sin marcarse como pagada."}
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Link
                href="/reservar"
                className="rounded-xl px-4 py-3 text-sm font-extrabold shadow-sm transition bg-slate-900 text-white hover:opacity-95 text-center"
              >
                Volver a reservar
              </Link>

              <Link
                href="/"
                className="rounded-xl px-4 py-3 text-sm font-extrabold shadow-sm transition bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 text-center"
              >
                Ir al inicio
              </Link>
            </div>

            <div className="mt-4 text-xs text-slate-500">
              🔒 Si llegaste aquí desde un enlace privado, guárdalo para futuras modificaciones (siempre respetando la política de 3 horas).
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50">
          <div className="mx-auto max-w-3xl px-4 py-8">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
              <div className="h-6 w-44 rounded bg-slate-100 animate-pulse" />
              <div className="mt-3 h-4 w-72 rounded bg-slate-100 animate-pulse" />
              <div className="mt-6 grid gap-3">
                <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
              </div>
            </div>
          </div>
        </main>
      }
    >
      <ResultInner />
    </Suspense>
  );
}
