"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Appt = {
  id: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  start_at: string;
  end_at: string;
  professional_name?: string | null;
  service_name?: string | null;
};

const tz = "America/Santiago";

const fmtLongDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

const fmtDateTimeShort = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

function toLocalDatetimeValue(isoUTC: string) {
  const d = new Date(isoUTC);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function addMinutesISOFromLocalDatetime(localDT: string, mins: number) {
  const d = new Date(localDT);
  const end = new Date(d.getTime() + mins * 60 * 1000);
  return { startISO: d.toISOString(), endISO: end.toISOString() };
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const meta =
    s === "canceled"
      ? { label: "Cancelada", cls: "bg-red-50 text-red-700 border-red-200" }
      : s === "rescheduled"
        ? { label: "Reagendada", cls: "bg-amber-50 text-amber-800 border-amber-200" }
        : s === "confirmed"
          ? { label: "Confirmada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
          : { label: status || "Estado", cls: "bg-slate-50 text-slate-700 border-slate-200" };

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold ${meta.cls}`}>
      <span className="inline-block w-2 h-2 rounded-full bg-current opacity-60" />
      {meta.label}
    </span>
  );
}

function GestionarCitaInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token") || "";

  const [appt, setAppt] = useState<Appt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "cancel" | "reschedule">(null);
  const [error, setError] = useState<string | null>(null);

  const [newStartLocal, setNewStartLocal] = useState<string>("");

  const rescheduleRef = useRef<HTMLDivElement | null>(null);
  const scrollToReschedule = () => {
    rescheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const durationMins = useMemo(() => {
    if (!appt?.start_at || !appt?.end_at) return 60;
    const a = new Date(appt.start_at).getTime();
    const b = new Date(appt.end_at).getTime();
    const diff = Math.max(0, b - a);
    return Math.max(30, Math.round(diff / (60 * 1000)));
  }, [appt?.start_at, appt?.end_at]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);

      if (!token) {
        setError("Falta el token. Abre este enlace desde tu correo de confirmación.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/appointments/by-token?token=${encodeURIComponent(token)}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(t || `No se pudo cargar la cita (HTTP ${res.status})`);
        }

        const data = await res.json();
        const row: Appt = data?.appointment ?? data;

        setAppt(row);
        if (row?.start_at) setNewStartLocal(toLocalDatetimeValue(row.start_at));
      } catch (e: any) {
        setError(e?.message || "Error cargando la cita");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [token]);

  const isCanceled = (appt?.status || "").toLowerCase() === "canceled";

  const goResult = (qs: string) => {
    try {
      router.push(`/reservar/resultado${qs}`);
    } catch {
      window.location.href = `/reservar/resultado${qs}`;
    }
  };

  const onCancel = async () => {
    if (!token) return;
    if (!confirm("¿Seguro que quieres cancelar esta cita?")) return;

    setBusy("cancel");
    setError(null);
    try {
      const res = await fetch(`/api/appointments/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `No se pudo cancelar (HTTP ${res.status})`);
      }

      goResult(`?status=canceled`);
    } catch (e: any) {
      setError(e?.message || "Error al cancelar");
    } finally {
      setBusy(null);
    }
  };

  const onRescheduleInline = async () => {
    if (!token) return;
    if (!newStartLocal) {
      setError("Selecciona una nueva fecha/hora de inicio.");
      return;
    }

    setBusy("reschedule");
    setError(null);
    try {
      const { startISO, endISO } = addMinutesISOFromLocalDatetime(newStartLocal, durationMins);

      const res = await fetch(`/api/appointments/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, start_at: startISO, end_at: endISO }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `No se pudo reagendar (HTTP ${res.status})`);
      }

      goResult(`?status=rescheduled&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
    } catch (e: any) {
      setError(e?.message || "Error al reagendar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
                  Gestionar cita
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Reagenda o cancela tu hora desde este enlace privado.
                </p>
              </div>

              <div className="flex flex-col items-end gap-2">
                <StatusBadge status={appt?.status || "loading"} />
                <div className="text-[11px] text-slate-500">🔒 Enlace privado · no lo compartas</div>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="mt-5 grid gap-3">
                <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
              </div>
            ) : null}

            {!loading && appt ? (
              <div className="mt-5 grid gap-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-white border border-slate-200 p-4">
                      <div className="text-xs font-semibold text-slate-500">Cliente</div>
                      <div className="mt-1 text-sm font-bold text-slate-900">{appt.customer_name || "—"}</div>

                      <div className="mt-3 text-xs font-semibold text-slate-500">Contacto</div>
                      <div className="mt-1 text-sm text-slate-800">
                        {appt.customer_phone ? `📞 ${appt.customer_phone}` : "📞 —"}
                      </div>
                      <div className="mt-1 text-sm text-slate-800">
                        {appt.customer_email ? `✉️ ${appt.customer_email}` : "✉️ —"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white border border-slate-200 p-4">
                      <div className="text-xs font-semibold text-slate-500">Tu cita</div>
                      <div className="mt-1 text-sm font-bold text-slate-900">{fmtLongDate(appt.start_at)}</div>
                      <div className="mt-1 text-sm text-slate-800">
                        🕒 {fmtTime(appt.start_at)} – {fmtTime(appt.end_at)}
                      </div>

                      <div className="mt-3 text-xs font-semibold text-slate-500">Profesional</div>
                      <div className="mt-1 text-sm text-slate-800">
                        {appt.professional_name ? `👤 ${appt.professional_name}` : "👤 —"}
                      </div>

                      <div className="mt-3 text-xs font-semibold text-slate-500">Código</div>
                      <div className="mt-1 font-mono text-xs text-slate-700">{appt.id}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="text-sm font-extrabold text-slate-900">Acciones</div>
                  <div className="mt-1 text-sm text-slate-600">Puedes reagendar o cancelar tu cita en segundos.</div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={scrollToReschedule}
                      disabled={busy !== null || isCanceled}
                      className={`rounded-xl px-4 py-3 text-sm font-extrabold shadow-sm transition
                        ${isCanceled ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:opacity-95"}
                      `}
                    >
                      {isCanceled ? "Reagendar (no disponible)" : "Reagendar cita"}
                    </button>

                    <button
                      type="button"
                      onClick={onCancel}
                      disabled={busy !== null || isCanceled}
                      className={`rounded-xl px-4 py-3 text-sm font-extrabold shadow-sm transition
                        ${isCanceled ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-red-600 text-white hover:opacity-95"}
                      `}
                    >
                      {busy === "cancel" ? "Cancelando..." : isCanceled ? "Cita cancelada" : "Cancelar cita"}
                    </button>
                  </div>

                  <div ref={rescheduleRef} className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-extrabold text-slate-900">Reagendar</div>
                        <div className="mt-1 text-sm text-slate-600">
                          Cambia la hora aquí mismo (duración fija: <b>{durationMins} min</b>)
                        </div>
                      </div>
                      <span className="text-xs text-slate-500">
                        {appt.start_at ? `Actual: ${fmtDateTimeShort(appt.start_at)}` : ""}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] items-end">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600">Nueva fecha y hora (inicio)</label>
                        <input
                          type="datetime-local"
                          value={newStartLocal}
                          onChange={(e) => setNewStartLocal(e.target.value)}
                          disabled={busy !== null || isCanceled}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900/20"
                        />
                        <div className="mt-2 text-xs text-slate-600">
                          Fin automático:{" "}
                          <b>
                            {newStartLocal
                              ? fmtDateTimeShort(addMinutesISOFromLocalDatetime(newStartLocal, durationMins).endISO)
                              : "—"}
                          </b>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={onRescheduleInline}
                        disabled={busy !== null || isCanceled}
                        className={`rounded-xl px-4 py-3 text-sm font-extrabold shadow-sm transition
                          ${isCanceled ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-amber-500 text-slate-900 hover:opacity-95"}
                        `}
                      >
                        {busy === "reschedule" ? "Guardando..." : "Guardar reagendamiento"}
                      </button>
                    </div>

                    {isCanceled ? (
                      <div className="mt-3 text-xs text-slate-500">Esta cita está cancelada; no se puede reagendar.</div>
                    ) : null}
                  </div>

                  <div className="mt-4 text-xs text-slate-500">
                    💡 Si este enlace fue compartido por error, crea una nueva reserva y usa el nuevo correo.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function PageSkeleton() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="h-6 w-40 rounded bg-slate-100 animate-pulse" />
          <div className="mt-3 h-4 w-64 rounded bg-slate-100 animate-pulse" />
          <div className="mt-6 grid gap-3">
            <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GestionarCitaInner />
    </Suspense>
  );
}
