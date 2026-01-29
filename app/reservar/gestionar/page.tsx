"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* =========================
   Tipos
========================= */

type Plan = "basic" | "pro";

type Appt = {
  id: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  start_at: string;
  end_at: string;

  tenant_id?: string | null;
  professional_id?: string | null;

  professional_name?: string | null;
  service_name?: string | null;

  // viene desde backend (NO editable por cliente)
  tenant_plan?: Plan | string | null;

  // FUTURO:
  // tenant_logo_url?: string | null; // 👈 aquí pondrás el logo
};

type Slot = {
  start_at: string;
  end_at: string;
};

type SlotsByDay = {
  dayKey: string;
  label: string;
  slots: Slot[];
};

/* =========================
   Constantes
========================= */

const tz = "America/Santiago";
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/* =========================
   Helpers fecha / hora
========================= */

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
    hour: "numeric",
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

/* =========================
   Slots helpers (estilo /reservar)
========================= */

function dayKeyCL(iso: string) {
  const d = parseTimestamptz(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find(p => p.type === "year")?.value ?? "";
  const m = parts.find(p => p.type === "month")?.value ?? "";
  const da = parts.find(p => p.type === "day")?.value ?? "";
  return `${y}-${m}-${da}`;
}

function dayLabelCL(dayKey: string) {
  const d = new Date(`${dayKey}T12:00:00`);
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
  }).format(d);
}

function slotBucketLabel(iso: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(parseTimestamptz(iso))
  );
  if (hour < 12) return "Mañana";
  if (hour < 18) return "Tarde";
  return "Noche";
}

function fmtHourButton(iso: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(parseTimestamptz(iso));
}

function isPlanPro(v: any): boolean {
  return String(v ?? "").toLowerCase() === "pro";
}

/* =========================
   UI helpers
========================= */

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
  const [notice, setNotice] = useState<string | null>(null);

  // ✅ Plan NO visible: lo define el backend (tenant_plan)
  const plan: Plan = isPlanPro(appt?.tenant_plan) ? "pro" : "basic";

  // ✅ Slots estilo /reservar
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedSlotStartISO, setSelectedSlotStartISO] = useState<string>("");

  const rescheduleRef = useRef<HTMLDivElement | null>(null);
  const scrollToReschedule = () =>
    rescheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Duración real (siempre tomamos la que está en la cita)
  const durationMins = useMemo(() => {
    if (!appt?.start_at || !appt?.end_at) return 30;
    const a = parseTimestamptz(appt.start_at).getTime();
    const b = parseTimestamptz(appt.end_at).getTime();
    const diff = Math.max(0, b - a);
    return Math.max(30, Math.round(diff / (60 * 1000)));
  }, [appt?.start_at, appt?.end_at]);

  // 1) Cargar cita por token
  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      setNotice(null);

      if (!token) {
        setError("Falta el token. Abre este enlace desde tu correo de confirmación.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/appointments/by-token?token=${encodeURIComponent(token)}`,
          { method: "GET", headers: { "Content-Type": "application/json" } }
        );

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          const msg = data?.message || data?.error || `No se pudo cargar la cita (HTTP ${res.status})`;
          throw new Error(String(msg));
        }

        const row: Appt = data?.appointment ?? data;
        setAppt(row);
      } catch (e: any) {
        setError(e?.message || "Error cargando la cita");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [token]);

  const isCanceled = (appt?.status || "").toLowerCase() === "canceled";

  // Lock 3h
  const isLocked3h = useMemo(() => {
    if (!appt?.start_at) return false;
    const startMs = parseTimestamptz(appt.start_at).getTime();
    if (!Number.isFinite(startMs)) return false;
    return startMs - Date.now() < THREE_HOURS_MS;
  }, [appt?.start_at]);

  const goResult = (qs: string) => {
    try {
      router.push(`/reservar/resultado${qs}`);
    } catch {
      window.location.href = `/reservar/resultado${qs}`;
    }
  };

  const blockIfLessThan3Hours = (): boolean => {
    if (!appt?.start_at) return false;

    const startMs = parseTimestamptz(appt.start_at).getTime();
    if (!Number.isFinite(startMs)) {
      setError("No se pudo validar la hora de la cita (formato inválido).");
      return true;
    }

    const msLeft = startMs - Date.now();
    if (msLeft <= 0 || msLeft < THREE_HOURS_MS) {
      setError("No puedes modificar esta cita con menos de 3 horas de anticipación.");
      return true;
    }

    return false;
  };

  // 2) Cargar slots disponibles para reagendar (igual que /reservar)
  useEffect(() => {
    const run = async () => {
      if (!appt?.tenant_id || !appt?.professional_id) return;

      setSlotsLoading(true);
      setSlotsError(null);

      try {
        const from = new Date();
        const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        const url =
          `/api/appointments/availability` +
          `?tenantId=${encodeURIComponent(appt.tenant_id)}` +
          `&professionalId=${encodeURIComponent(appt.professional_id)}` +
          `&from=${encodeURIComponent(from.toISOString())}` +
          `&to=${encodeURIComponent(to.toISOString())}`;

        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json?.error ?? "Error cargando horarios");

        const arr = Array.isArray(json?.slots) ? (json.slots as Slot[]) : [];
        setSlots(arr);

        // Selección inicial de día: el mismo día de la cita si existe, si no el primer día con slots
        const apptDay = appt?.start_at ? dayKeyCL(appt.start_at) : "";
        const dayKeys = Array.from(new Set(arr.map((s) => dayKeyCL(s.start_at)).filter(Boolean)));
        const initialDay = dayKeys.includes(apptDay) ? apptDay : (dayKeys[0] ?? "");

        setSelectedDay(initialDay);
        setSelectedSlotStartISO("");
      } catch (e: any) {
        setSlotsError(e?.message || "No se pudieron cargar los horarios");
        setSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    };

    run();
  }, [appt?.tenant_id, appt?.professional_id, appt?.start_at]);

  // Grouped days
  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();

    for (const s of slots) {
      const k = dayKeyCL(s.start_at);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }

    const days: SlotsByDay[] = Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([dayKey, daySlots]) => ({
        dayKey,
        label: dayLabelCL(dayKey),
        slots: daySlots.sort((a, b) => (a.start_at < b.start_at ? -1 : 1)),
      }));

    return days;
  }, [slots]);

  const daySlots = useMemo(() => {
    const day = grouped.find((g) => g.dayKey === selectedDay);
    return day?.slots ?? [];
  }, [grouped, selectedDay]);

  const buckets = useMemo(() => {
    const b: Record<string, Slot[]> = { Mañana: [], Tarde: [], Noche: [] };
    for (const s of daySlots) {
      const key = slotBucketLabel(s.start_at);
      (b[key] ?? (b[key] = [])).push(s);
    }
    return b;
  }, [daySlots]);

  // Cancelar
  const onCancel = async () => {
    if (!token) return;
    if (blockIfLessThan3Hours()) return;
    if (!confirm("¿Seguro que quieres cancelar esta cita?")) return;

    setBusy("cancel");
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/appointments/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = data?.message || data?.error || `No se pudo cancelar (HTTP ${res.status})`;
        throw new Error(String(msg));
      }

      goResult(`?status=canceled`);
    } catch (e: any) {
      setError(e?.message || "Error al cancelar");
    } finally {
      setBusy(null);
    }
  };

  // Reagendar usando slot elegido
  const onReschedulePickSlot = async () => {
    if (!token) return;
    if (blockIfLessThan3Hours()) return;

    if (!selectedSlotStartISO) {
      setError("Selecciona una hora disponible.");
      return;
    }

    setBusy("reschedule");
    setError(null);
    setNotice(null);

    try {
      // slot seleccionado
      const chosen =
        daySlots.find((s) => s.start_at === selectedSlotStartISO) ||
        slots.find((s) => s.start_at === selectedSlotStartISO);

      if (!chosen?.start_at || !chosen?.end_at) {
        setError("No se pudo leer el horario seleccionado. Recarga la página.");
        return;
      }

      const res = await fetch(`/api/appointments/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, start_at: chosen.start_at, end_at: chosen.end_at }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (data?.error === "reschedule_limit_reached") {
          const used = Number(data?.meta?.used ?? 2);
          setError(`Esta cita ya fue reagendada ${used} veces (máximo 2).`);
          return;
        }
        const msg = data?.message || data?.error || `No se pudo reagendar (HTTP ${res.status})`;
        throw new Error(String(msg));
      }

      // ✅ éxito
      goResult(
        `?status=rescheduled&start=${encodeURIComponent(chosen.start_at)}&end=${encodeURIComponent(chosen.end_at)}`
      );
    } catch (e: any) {
      setError(e?.message || "Error al reagendar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Toque “magic” liviano: fondo suave */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-slate-200/60 via-slate-100/30 to-slate-200/60 blur-3xl" />
        <div className="absolute -bottom-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-100/40 via-slate-100/20 to-emerald-100/30 blur-3xl" />
      </div>
            <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur shadow-sm">
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* TODO (branding): cuando tengas tenants.logo_url, aquí lo renderizamos */}
                {/* <img src={appt?.tenant_logo_url ?? ""} alt="Logo" className="h-10 w-10 rounded-full object-cover" /> */}

                <div>
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
                    Gestionar cita
                  </h1>
                  <p className="mt-1 text-sm text-slate-600">
                    Reagenda o cancela tu hora desde este enlace privado.
                  </p>
                </div>
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

            {notice ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {notice}
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
                {/* Resumen cita */}
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

                      <div className="mt-3 text-xs font-semibold text-slate-500">Servicio</div>
                      <div className="mt-1 text-sm text-slate-800">
                        {appt.service_name ? `💈 ${appt.service_name}` : "💈 —"}
                      </div>

                      <div className="mt-3 text-xs font-semibold text-slate-500">Código</div>
                      <div className="mt-1 font-mono text-xs text-slate-700">{appt.id}</div>
                    </div>
                  </div>
                </div>

                {/* Acciones */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="text-sm font-extrabold text-slate-900">Acciones</div>
                  <div className="mt-1 text-sm text-slate-600">Puedes reagendar o cancelar tu cita en segundos.</div>

                  {isLocked3h && !isCanceled ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      ⏳ Esta cita ya está dentro de las <b>3 horas</b> previas, por lo que no se puede modificar.
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={scrollToReschedule}
                      disabled={busy !== null || isCanceled || isLocked3h}
                      className={`rounded-xl px-4 py-3 text-sm font-extrabold shadow-sm transition
                        ${
                          isCanceled || isLocked3h
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-slate-900 text-white hover:opacity-95"
                        }
                      `}
                    >
                      {isCanceled ? "Reagendar (no disponible)" : isLocked3h ? "Reagendar (bloqueado)" : "Reagendar cita"}
                    </button>

                    <button
                      type="button"
                      onClick={onCancel}
                      disabled={busy !== null || isCanceled || isLocked3h}
                      className={`rounded-xl px-4 py-3 text-sm font-extrabold shadow-sm transition
                        ${
                          isCanceled || isLocked3h
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-red-600 text-white hover:opacity-95"
                        }
                      `}
                    >
                      {busy === "cancel"
                        ? "Cancelando..."
                        : isCanceled
                          ? "Cita cancelada"
                          : isLocked3h
                            ? "Cancelar (bloqueado)"
                            : "Cancelar cita"}
                    </button>
                  </div>

                  {/* Reagendar (nuevo UI estilo /reservar) */}
                  <div ref={rescheduleRef} className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-extrabold text-slate-900">Reagendar</div>
                        <div className="mt-1 text-sm text-slate-600">
                          Selecciona un día y una hora disponible (duración fija: <b>{durationMins} min</b>)
                        </div>
                      </div>
                      <span className="text-xs text-slate-500">
                        {appt.start_at ? `Actual: ${fmtDateTimeShort(appt.start_at)}` : ""}
                      </span>
                    </div>

                    {/* BLOQUE DE UI DE SLOTS (el que editaste) */}
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-extrabold text-slate-900">Selecciona fecha y hora</div>
                          <div className="mt-1 text-sm text-slate-600">Te mostraremos solo los horarios disponibles.</div>
                        </div>
                        <span className="text-xs text-slate-500">
                          {appt.start_at ? `Actual: ${fmtDateTimeShort(appt.start_at)}` : ""}
                        </span>
                      </div>

                      {slotsLoading ? (
                        <div className="mt-4 h-24 rounded-xl bg-slate-100 animate-pulse" />
                      ) : slotsError ? (
                        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                          {slotsError}
                        </div>
                      ) : grouped.length === 0 ? (
                        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          No hay horarios disponibles por ahora.
                        </div>
                      ) : (
                        <>
                          {/* Selector de días */}
                          <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2">
                            {grouped.slice(0, 14).map((d) => (
                              <button
                                key={d.dayKey}
                                type="button"
                                onClick={() => {
                                  setSelectedDay(d.dayKey);
                                  setSelectedSlotStartISO("");
                                }}
                                className={`shrink-0 rounded-xl px-3 py-2 text-sm font-bold border transition ${
                                  selectedDay === d.dayKey
                                    ? "bg-slate-900 text-white border-slate-900"
                                    : "bg-white text-slate-900 border-slate-200 hover:bg-slate-50"
                                }`}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>

                          {/* Horas por bloque */}
                          <div className="mt-4 grid gap-4">
                            {(["Mañana", "Tarde", "Noche"] as const).map((label) => {
                              const list = buckets[label] ?? [];
                              if (list.length === 0) return null;

                              return (
                                <div key={label}>
                                  <div className="text-xs font-bold text-slate-600">{label}</div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {list.map((s) => (
                                      <button
                                        key={s.start_at}
                                        type="button"
                                        onClick={() => setSelectedSlotStartISO(s.start_at)}
                                        className={`rounded-xl px-3 py-2 text-sm font-bold border transition ${
                                          selectedSlotStartISO === s.start_at
                                            ? "bg-blue-600 text-white border-blue-600"
                                            : "bg-white text-slate-900 border-slate-200 hover:bg-slate-50"
                                        }`}
                                      >
                                        {fmtHourButton(s.start_at)}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                            ⚠️ Las horas disponibles podrían agotarse. Agenda lo antes posible.
                          </div>
                        </>
                      )}
                    </div>

                    {/* CTA guardar */}
                    <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="text-sm text-slate-700">
                        {selectedSlotStartISO ? (
                          <>
                            Nuevo horario:{" "}
                            <b>
                              {fmtLongDate(selectedSlotStartISO)} · {fmtTime(selectedSlotStartISO)}
                            </b>
                          </>
                        ) : (
                          "Elige un horario para continuar."
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={onReschedulePickSlot}
                        disabled={busy !== null || isCanceled || isLocked3h || !selectedSlotStartISO}
                        className={`rounded-xl px-5 py-3 text-sm font-extrabold shadow-sm transition
                          ${
                            busy !== null || isCanceled || isLocked3h || !selectedSlotStartISO
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                              : "bg-amber-500 text-slate-900 hover:opacity-95"
                          }
                        `}
                      >
                        {busy === "reschedule"
                          ? "Guardando..."
                          : isCanceled
                            ? "No disponible"
                            : isLocked3h
                              ? "Bloqueado"
                              : "Guardar reagendamiento"}
                      </button>
                    </div>

                    {/* Pro: solo un hint interno (no se muestra como switch). */}
                    {plan === "pro" ? (
                      <div className="mt-3 text-xs text-emerald-700">
                        ✅ Plan Pro: luego podemos activar confirmación por WhatsApp automáticamente (sin que el cliente elija).
                      </div>
                    ) : null}

                    {isCanceled ? (
                      <div className="mt-3 text-xs text-slate-500">
                        Esta cita está cancelada; no se puede reagendar.
                      </div>
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