"use client";

import Link from "next/link";
import React, { Suspense, useEffect, useMemo, useState } from "react";
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

type ManualPaymentInstructions = {
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  bankRut: string;
  bankEmail: string;
};

type AppointmentResult = {
  id?: string;
  payment_provider?: string | null;
};

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
  const appointmentId = sp.get("id");
  const start = sp.get("start");
  const end = sp.get("end");
  const [appointment, setAppointment] = useState<AppointmentResult | null>(null);
  const [manualInstructions, setManualInstructions] = useState<{
    appointmentId: string;
    details: ManualPaymentInstructions;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");

  const isRescheduled = status === "rescheduled";
  const isCanceled = status === "canceled";
  const isPaymentSuccess = status === "success";
  const isPaymentFailure = status === "failure";
  const isPaymentPending = status === "pending";
  const paymentProvider = String(
    appointment?.payment_provider ?? sp.get("provider") ?? "",
  ).toLowerCase();
  const isManualPayment = paymentProvider === "manual";
  const bankDetails =
    isManualPayment && manualInstructions?.appointmentId === appointmentId
      ? manualInstructions.details
      : null;

  useEffect(() => {
    if (!appointmentId) return;

    let cancelled = false;

    (async () => {
      try {
        const manageToken = sessionStorage.getItem("citaya_manage_token:" + appointmentId) ?? "";
        if (!manageToken) return;
        const res = await fetch(
          `/api/appointments/by-id?id=${encodeURIComponent(appointmentId)}`,
          { cache: "no-store", headers: { "x-manage-token": manageToken } },
        );
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.appointment) return;
        if (!cancelled) setAppointment(json.appointment);
      } catch (error) {
        console.error("[resultado] error cargando cita:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  useEffect(() => {
    if (!appointmentId || !isManualPayment) return;

    let cancelled = false;
    (async () => {
      try {
        const manageToken =
          sessionStorage.getItem("citaya_manage_token:" + appointmentId) ?? "";
        if (!manageToken) return;
        const res = await fetch(
          `/api/appointments/payment-instructions?appointmentId=${encodeURIComponent(appointmentId)}`,
          {
            cache: "no-store",
            headers: { "x-manage-token": manageToken },
          },
        );
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.instructions) return;
        if (!cancelled) {
          setManualInstructions({
            appointmentId,
            details: json.instructions,
          });
        }
      } catch {
        // The endpoint is intentionally fail-closed and returns no partial data.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appointmentId, isManualPayment]);

  const title = isRescheduled
    ? "¡Listo! Tu cita ha sido reagendada"
    : isCanceled
      ? "Listo: tu cita ha sido cancelada"
      : isManualPayment
        ? "Pago pendiente"
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
      : isManualPayment
        ? "Completa el pago por transferencia para confirmar tu reserva."
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

  const transferText = useMemo(
    () =>
      [
        "Datos para transferencia:",
        `Banco: ${bankDetails?.bankName ?? "No disponible"}`,
        `Tipo de cuenta: ${bankDetails?.bankAccountType ?? "No disponible"}`,
        `Número de cuenta: ${bankDetails?.bankAccountNumber ?? "No disponible"}`,
        `Titular: ${bankDetails?.bankAccountHolder ?? "No disponible"}`,
        `RUT: ${bankDetails?.bankRut ?? "No disponible"}`,
        `Email: ${bankDetails?.bankEmail ?? "No disponible"}`,
        "",
        "Envía el comprobante al negocio para validar tu reserva.",
      ].join("\n"),
    [bankDetails],
  );

  const copyTransferDetails = async () => {
    try {
      await navigator.clipboard.writeText(transferText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }

    window.setTimeout(() => setCopyStatus("idle"), 2200);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                {title}
              </h1>
              <p className="text-sm text-gray-600">{subtitle}</p>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <StatusPill status={status} />
              {whenLabel ? (
                <div className="text-sm text-gray-500">🕒 {whenLabel}</div>
              ) : null}
            </div>
          </div>
        </div>

        {isRescheduled ? (
          <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm text-gray-500">Nuevo horario</div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                <div className="text-sm text-gray-500">Nuevo inicio</div>
                <div className="font-medium text-gray-900">
                  {start ? fmtLongDate(start) : "—"}
                </div>
                <div className="font-medium text-gray-800">
                  {start ? `🕒 ${fmtTime(start)}` : "—"}
                </div>
                <div className="text-sm text-gray-500">
                  {start ? fmtDateTimeShort(start) : ""}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                <div className="text-sm text-gray-500">Nuevo fin</div>
                <div className="font-medium text-gray-900">
                  {end ? fmtLongDate(end) : "—"}
                </div>
                <div className="font-medium text-gray-800">
                  {end ? `🕒 ${fmtTime(end)}` : "—"}
                </div>
                <div className="text-sm text-gray-500">
                  {end ? fmtDateTimeShort(end) : ""}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              💡 Te recomendamos llegar <b>5 minutos antes</b>.
            </div>
          </div>
        ) : null}

        {isCanceled ? (
          <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm text-gray-500">Cancelación confirmada</div>
            <div className="font-medium text-gray-800">
              Si necesitas una nueva hora, puedes reservar de nuevo cuando quieras.
            </div>
          </div>
        ) : null}

        {isPaymentSuccess || isPaymentPending || isPaymentFailure ? (
          <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm text-gray-500">Estado del pago</div>
            <div className="font-medium text-gray-800">
              {isManualPayment
                ? "Tu reserva está pendiente hasta que el negocio confirme el pago."
                : isPaymentSuccess
                ? "El checkout volvió correctamente. Aun así, el backend toma como fuente de verdad el webhook de Mercado Pago."
                : isPaymentPending
                  ? "La operación quedó pendiente en Mercado Pago. No marques la cita como pagada hasta recibir el webhook."
                  : "El pago falló o fue rechazado. La cita debería seguir sin marcarse como pagada."}
            </div>
          </div>
        ) : null}

        {isManualPayment && bankDetails ? (
          <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-extrabold text-gray-900">
                    Datos para transferencia
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    Envía el comprobante al negocio para validar tu reserva.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={copyTransferDetails}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 transition hover:bg-gray-50"
                >
                  {copyStatus === "copied"
                    ? "Datos copiados"
                    : copyStatus === "error"
                      ? "No se pudo copiar"
                      : "Copiar datos"}
                </button>
              </div>
            </div>

            <div className="grid gap-2 text-sm">
              {[
                ["Banco", bankDetails.bankName],
                ["Tipo", bankDetails.bankAccountType],
                ["Número", bankDetails.bankAccountNumber],
                ["Titular", bankDetails.bankAccountHolder],
                ["RUT", bankDetails.bankRut],
                ["Email", bankDetails.bankEmail],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-gray-500">{label}</span>
                  <span className="font-semibold text-gray-900">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : isManualPayment ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
            Las instrucciones de transferencia no están disponibles. Contacta al
            negocio antes de realizar el pago.
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/reservar"
            className="rounded-lg bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white transition hover:opacity-95"
          >
            Volver a reservar
          </Link>

          <Link
            href="/"
            className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-center text-sm font-bold text-gray-900 transition hover:bg-gray-50"
          >
            Ir al inicio
          </Link>
        </div>

        <div className="text-sm text-gray-500">
          🔒 Si llegaste aquí desde un enlace privado, guárdalo para futuras
          modificaciones (siempre respetando la política de 3 horas).
        </div>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-lg space-y-4">
            <div className="h-7 w-48 rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-slate-100 animate-pulse" />
            <div className="h-28 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      }
    >
      <ResultInner />
    </Suspense>
  );
}
