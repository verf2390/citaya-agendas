"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ShimmerButton from "@/components/magicui/ShimmerButton";
import {
  CalendarClock,
  XCircle,
  Lock,
  Check,
  AlertTriangle,
  CalendarDays,
  Sunrise,
  Sun,
  Moon,
  Sparkles,
  User,
  Mail,
  Phone,
} from "lucide-react";

/* =========================
   Tipos
========================= */

type Plan = "basic" | "pro";

type Appt = {
  id: string;
  status: string;
  service_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  start_at: string;
  end_at: string;

  tenant_id?: string | null;
  professional_id?: string | null;

  professional_name?: string | null;
  service_name?: string | null;

  tenant_plan?: Plan | string | null;
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

/* =========================
   Slots helpers
========================= */

function dayKeyCL(iso: string) {
  const d = parseTimestamptz(iso);
  if (!Number.isFinite(d.getTime())) return "";

  // ✅ Key estable en TZ Chile
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const da = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${da}`;
}

function dateFromDayKeyUTCNoon(dayKey: string) {
  // ✅ FIX: evita que el navegador (local TZ) desplace el día/mes
  const [yy, mm, dd] = String(dayKey || "").split("-").map((x) => Number(x));
  if (!yy || !mm || !dd) return new Date(NaN);
  return new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0));
}

function dayLabelCL(dayKey: string) {
  const d = dateFromDayKeyUTCNoon(dayKey);
  if (!Number.isFinite(d.getTime())) return "";
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
    }).format(parseTimestamptz(iso)),
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

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const meta =
    s === "canceled"
      ? { label: "Cancelada", cls: "bg-red-50 text-red-700 border-red-200" }
      : s === "rescheduled"
        ? {
            label: "Reagendada",
            cls: "bg-amber-50 text-amber-800 border-amber-200",
          }
        : s === "confirmed"
          ? {
              label: "Confirmada",
              cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
            }
          : {
              label: status || "Estado",
              cls: "bg-slate-50 text-slate-700 border-slate-200",
            };

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${meta.cls}`}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-current opacity-60" />
      {meta.label}
    </span>
  );
}

function BucketIcon({ label }: { label: "Mañana" | "Tarde" | "Noche" }) {
  if (label === "Mañana") return <Sunrise className="h-4 w-4" />;
  if (label === "Tarde") return <Sun className="h-4 w-4" />;
  return <Moon className="h-4 w-4" />;
}

function SectionHeader({
  icon,
  title,
  subtitle,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-white/80 ring-1 ring-slate-200">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-slate-900 sm:text-base">
              {title}
            </div>
            {subtitle ? (
              <div className="mt-0.5 text-[11px] text-slate-600 sm:mt-1 sm:text-sm">
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/* =========================
   Page
========================= */

function GestionarCitaInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token") || "";

  const [appt, setAppt] = useState<Appt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "cancel" | "reschedule">(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const plan: Plan = isPlanPro(appt?.tenant_plan) ? "pro" : "basic";

  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedSlotStartISO, setSelectedSlotStartISO] = useState<string>("");

  const rescheduleRef = useRef<HTMLDivElement | null>(null);
  const scrollToReschedule = () =>
    rescheduleRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

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
        setError(
          "Falta el token. Abre este enlace desde tu correo de confirmación.",
        );
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/appointments/by-token?token=${encodeURIComponent(token)}`,
          { method: "GET", headers: { "Content-Type": "application/json" } },
        );

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          const msg =
            data?.message ||
            data?.error ||
            `No se pudo cargar la cita (HTTP ${res.status})`;
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
      setError(
        "No puedes modificar esta cita con menos de 3 horas de anticipación.",
      );
      return true;
    }

    return false;
  };

  // 2) Cargar slots para reagendar
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
          `&to=${encodeURIComponent(to.toISOString())}` +
          (appt.service_id
            ? `&serviceId=${encodeURIComponent(appt.service_id)}`
            : "");

        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json?.error ?? "Error cargando horarios");

        const arr = Array.isArray(json?.slots) ? (json.slots as Slot[]) : [];
        setSlots(arr);

        const apptDay = appt?.start_at ? dayKeyCL(appt.start_at) : "";
        const dayKeys = Array.from(
          new Set(arr.map((s) => dayKeyCL(s.start_at)).filter(Boolean)),
        );

        const initialDay = dayKeys.includes(apptDay)
          ? apptDay
          : (dayKeys[0] ?? "");

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
  }, [appt?.tenant_id, appt?.professional_id, appt?.start_at, appt?.service_id]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = dayKeyCL(s.start_at);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }

    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([dayKey, daySlots]) => ({
        dayKey,
        label: dayLabelCL(dayKey),
        slots: daySlots.sort((a, b) => (a.start_at < b.start_at ? -1 : 1)),
      })) as SlotsByDay[];
  }, [slots]);

  // ✅ Si selectedDay queda inválido (por refresh de slots), lo reparamos
  useEffect(() => {
    if (!grouped.length) return;
    if (!selectedDay || !grouped.some((g) => g.dayKey === selectedDay)) {
      setSelectedDay(grouped[0].dayKey);
      setSelectedSlotStartISO("");
    }
  }, [grouped, selectedDay]);

  const daySlots = useMemo(
    () => grouped.find((g) => g.dayKey === selectedDay)?.slots ?? [],
    [grouped, selectedDay],
  );

  const buckets = useMemo(() => {
    const b: Record<string, Slot[]> = { Mañana: [], Tarde: [], Noche: [] };
    for (const s of daySlots) {
      const key = slotBucketLabel(s.start_at);
      (b[key] ?? (b[key] = [])).push(s);
    }
    return b;
  }, [daySlots]);

  const bucketCounts = useMemo(() => {
    return {
      Mañana: (buckets.Mañana ?? []).length,
      Tarde: (buckets.Tarde ?? []).length,
      Noche: (buckets.Noche ?? []).length,
    };
  }, [buckets]);

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
        const msg =
          data?.message ||
          data?.error ||
          `No se pudo cancelar (HTTP ${res.status})`;
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
        body: JSON.stringify({
          token,
          start_at: chosen.start_at,
          end_at: chosen.end_at,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (data?.error === "reschedule_limit_reached") {
          const used = Number(data?.meta?.used ?? 2);
          setError(`Esta cita ya fue reagendada ${used} veces (máximo 2).`);
          return;
        }
        const msg =
          data?.message ||
          data?.error ||
          `No se pudo reagendar (HTTP ${res.status})`;
        throw new Error(String(msg));
      }

      goResult(
        `?status=rescheduled&start=${encodeURIComponent(
          chosen.start_at,
        )}&end=${encodeURIComponent(chosen.end_at)}`,
      );
    } catch (e: any) {
      setError(e?.message || "Error al reagendar");
    } finally {
      setBusy(null);
    }
  };

  const actionsDisabled = busy !== null || isCanceled || isLocked3h;

  // ✅ key para micro fade al cambiar día / slot
  const slotsPanelKey = useMemo(() => {
    return `${selectedDay}:${appt?.professional_id ?? ""}:${appt?.service_id ?? ""}`;
  }, [selectedDay, appt?.professional_id, appt?.service_id]);

  return (
    <main className="min-h-screen overflow-x-clip bg-gradient-to-b from-background to-muted/40">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-20 left-1/2 h-56 w-[28rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-slate-200/60 via-slate-100/30 to-slate-200/60 blur-3xl sm:h-72 sm:w-[42rem]" />
        <div className="absolute -bottom-24 left-1/2 h-64 w-[28rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-100/40 via-slate-100/20 to-emerald-100/30 blur-3xl sm:h-72 sm:w-[42rem]" />
      </div>

      <div className="mx-auto w-full max-w-[460px] px-3 pb-24 pt-2 font-[system-ui] text-[12px] leading-snug sm:max-w-3xl sm:px-4 sm:pb-16 sm:pt-4 sm:text-[14px] sm:leading-normal lg:max-w-6xl lg:px-6 lg:pb-24 lg:pt-6">
        {/* Header sticky (similar Reservar) */}
        <div className="sticky top-0 z-40 -mx-3 border-b bg-background/85 px-3 pb-2 pt-2 backdrop-blur sm:-mx-4 sm:px-4 lg:static lg:mx-0 lg:border-b-0 lg:bg-transparent lg:px-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold sm:text-base">
                Gestionar cita
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground sm:text-sm">
                Reagenda o cancela tu hora desde este enlace privado.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge status={appt?.status || "loading"} />
              <span className="hidden sm:inline-flex items-center gap-2 rounded-full border bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
                <Lock className="h-3.5 w-3.5" /> Enlace privado
              </span>
            </div>
          </div>

          {error ? (
            <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-2 text-[11px] text-red-800 sm:p-2.5 sm:text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>{error}</div>
              </div>
            </div>
          ) : null}

          {notice ? (
            <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-900 sm:p-2.5 sm:text-sm">
              {notice}
            </div>
          ) : null}
        </div>

        {/* Contenido */}
        <div className="pt-3 grid gap-2.5 sm:gap-4">
          {loading ? (
            <div className="grid gap-3">
              <div className="h-24 rounded-2xl bg-muted/60 animate-pulse" />
              <div className="h-20 rounded-2xl bg-muted/60 animate-pulse" />
            </div>
          ) : null}

          {!loading && appt ? (
            <>
              {/* Resumen cita (cards compactas mobile) */}
              <section className="rounded-2xl border bg-white/80 p-2.5 shadow-sm backdrop-blur sm:p-4">
                <SectionHeader
                  icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
                  title="Resumen de tu cita"
                  subtitle="Revisa tus datos y el horario actual."
                />

                <div className="mt-3 grid gap-2 sm:grid-cols-2 sm:gap-3">
                  <div className="rounded-2xl border bg-white p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-muted/40 ring-1 ring-border">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-muted-foreground">
                          Cliente
                        </div>
                        <div className="mt-0.5 truncate text-[12px] font-extrabold sm:text-sm">
                          {appt.customer_name || "—"}
                        </div>

                        <div className="mt-2 text-[11px] font-semibold text-muted-foreground">
                          Contacto
                        </div>

                        <div className="mt-1 text-[11px] text-foreground flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate">
                            {appt.customer_phone || "—"}
                          </span>
                        </div>

                        <div className="mt-1 text-[11px] text-foreground flex items-start gap-2">
                          <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <span className="break-words">
                            {appt.customer_email || "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-white p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-muted/40 ring-1 ring-border">
                        <CalendarClock className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-muted-foreground">
                          Tu cita
                        </div>
                        <div className="mt-0.5 text-[12px] font-extrabold sm:text-sm">
                          {fmtLongDate(appt.start_at)}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          🕒 {fmtTime(appt.start_at)} – {fmtTime(appt.end_at)}
                        </div>

                        <div className="mt-2 text-[11px] font-semibold text-muted-foreground">
                          Profesional
                        </div>
                        <div className="mt-0.5 text-[11px] text-foreground">
                          {appt.professional_name ? `👤 ${appt.professional_name}` : "👤 —"}
                        </div>

                        <div className="mt-2 text-[11px] font-semibold text-muted-foreground">
                          Servicio
                        </div>
                        <div className="mt-0.5 text-[11px] text-foreground">
                          {appt.service_name ? `💈 ${appt.service_name}` : "💈 —"}
                        </div>

                        <div className="mt-2 text-[11px] font-semibold text-muted-foreground">
                          Código
                        </div>
                        <div className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                          {appt.id}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Bloqueo 3h */}
              {isLocked3h && !isCanceled ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 sm:p-3 sm:text-sm">
                  ⏳ Esta cita ya está dentro de las <b>3 horas</b> previas, por lo
                  que no se puede modificar.
                </div>
              ) : null}

              {/* Acciones */}
              <section className="rounded-2xl border bg-white/80 p-2.5 shadow-sm backdrop-blur sm:p-4">
                <SectionHeader
                  icon={<Sparkles className="h-4 w-4 text-muted-foreground" />}
                  title="Acciones"
                  subtitle="Reagenda o cancela tu cita en segundos."
                  right={
                    <span className="inline-flex items-center gap-2 rounded-full border bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
                      <Lock className="h-3.5 w-3.5" /> Privado
                    </span>
                  }
                />

                <div className="mt-3 grid gap-2 sm:grid-cols-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={scrollToReschedule}
                    disabled={actionsDisabled}
                    className={cn(
                      "w-full rounded-2xl border bg-white px-3 py-2 text-left transition",
                      "min-h-[44px]",
                      "hover:bg-muted/40 active:scale-[0.98] motion-reduce:active:scale-100",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-muted/40 ring-1 ring-border">
                          <CalendarClock className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-extrabold sm:text-sm">
                            {isCanceled
                              ? "Reagendar (no disponible)"
                              : isLocked3h
                                ? "Reagendar (bloqueado)"
                                : "Reagendar cita"}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">
                            Elige un nuevo día y hora disponible
                          </div>
                        </div>
                      </div>

                      {isLocked3h || isCanceled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] font-extrabold text-muted-foreground">
                          <Lock className="h-3.5 w-3.5" /> Bloq.
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-1 text-[10px] font-extrabold text-background">
                          Abrir
                        </span>
                      )}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={actionsDisabled}
                    className={cn(
                      "w-full rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-left transition",
                      "min-h-[44px]",
                      "hover:bg-red-100 active:scale-[0.98] motion-reduce:active:scale-100",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/60 ring-1 ring-red-200">
                          <XCircle className="h-4 w-4 text-red-700" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-extrabold text-red-800 sm:text-sm">
                            {busy === "cancel"
                              ? "Cancelando..."
                              : isCanceled
                                ? "Cita cancelada"
                                : isLocked3h
                                  ? "Cancelar (bloqueado)"
                                  : "Cancelar cita"}
                          </div>
                          <div className="mt-0.5 text-[10px] text-red-800/80 sm:text-xs">
                            Esto libera el horario para otros clientes
                          </div>
                        </div>
                      </div>

                      {isLocked3h || isCanceled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-[10px] font-extrabold text-red-700">
                          <Lock className="h-3.5 w-3.5" /> Bloq.
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-700 px-2 py-1 text-[10px] font-extrabold text-white">
                          OK
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              </section>

              {/* Reagendar */}
              <section
                ref={rescheduleRef}
                className="rounded-2xl border bg-white/80 p-2.5 shadow-sm backdrop-blur sm:p-4"
              >
                <SectionHeader
                  icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
                  title="Reagendar"
                  subtitle={`Selecciona un día y una hora disponible (duración: ${durationMins} min)`}
                />

                {slotsLoading ? (
                  <div className="mt-3 h-28 rounded-2xl bg-muted/60 animate-pulse" />
                ) : slotsError ? (
                  <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-800 sm:text-sm">
                    {slotsError}
                  </div>
                ) : grouped.length === 0 ? (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 sm:text-sm">
                    No hay horarios disponibles por ahora.
                  </div>
                ) : (
                  <>
                    {/* Carrusel de días + fades (igual estilo Reservar) */}
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold sm:text-sm">
                        Elige un día
                      </div>

                      <div className="relative mt-2">
                        <div
                          aria-hidden
                          className="pointer-events-none absolute left-0 top-0 h-full w-6 bg-gradient-to-r from-background/90 to-transparent"
                        />
                        <div
                          aria-hidden
                          className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-background/90 to-transparent"
                        />

                        <div className="overflow-x-auto touch-pan-x overscroll-x-contain [-webkit-overflow-scrolling:touch]">
                          <div className="flex flex-nowrap gap-1.5 min-w-max items-center py-0.5">
                            {grouped.map((d) => {
                              const active = selectedDay === d.dayKey;
                              const count = d.slots?.length ?? 0;

                              return (
                                <button
                                  key={d.dayKey}
                                  type="button"
                                  onClick={() => {
                                    setSelectedDay(d.dayKey);
                                    setSelectedSlotStartISO("");
                                  }}
                                  className={cn(
                                    "shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ring-border transition",
                                    "sm:px-4 sm:py-2 sm:text-sm",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    active
                                      ? "bg-foreground text-background"
                                      : "bg-white hover:bg-muted",
                                  )}
                                >
                                  <span className="capitalize">{d.label}</span>
                                  <span
                                    className={cn(
                                      "ml-1 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-extrabold",
                                      active
                                        ? "bg-background/15 text-background"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {count === 0 ? "—" : count >= 9 ? "9+" : count}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Slots por buckets (tap-friendly) */}
                    <div
                      key={slotsPanelKey}
                      className={cn(
                        "mt-4 animate-in fade-in-0 duration-200",
                        "motion-reduce:animate-none",
                      )}
                    >
                      <div className="text-[11px] font-semibold sm:text-sm">
                        Elige una hora
                      </div>

                      <div className="mt-3 grid gap-3 sm:gap-4">
                        {(["Mañana", "Tarde", "Noche"] as const).map((label) => {
                          const list = buckets[label] ?? [];
                          if (list.length === 0) return null;

                          const count = bucketCounts[label] ?? 0;

                          return (
                            <div
                              key={label}
                              className="rounded-2xl border bg-white p-2.5 sm:p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-muted/40 ring-1 ring-border">
                                    <span className="text-muted-foreground">
                                      <BucketIcon label={label} />
                                    </span>
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-extrabold sm:text-sm">
                                      {label}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground sm:text-xs">
                                      {count === 1
                                        ? "1 horario"
                                        : `${count} horarios`}
                                    </div>
                                  </div>
                                </div>

                                <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-extrabold text-muted-foreground sm:text-xs">
                                  {count >= 99 ? "99+" : count}
                                </span>
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                {list.map((s) => {
                                  const active = selectedSlotStartISO === s.start_at;

                                  return (
                                    <button
                                      key={s.start_at}
                                      type="button"
                                      onClick={() => setSelectedSlotStartISO(s.start_at)}
                                      className={cn(
                                        "relative w-full rounded-2xl border bg-white text-left transition",
                                        "min-h-[44px] px-3 py-2",
                                        "hover:bg-muted/40 active:scale-[0.98] motion-reduce:active:scale-100",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        "shadow-[0_1px_0_rgba(0,0,0,0.02)]",
                                        active
                                          ? "border-foreground bg-foreground text-background shadow-sm ring-2 ring-foreground/20"
                                          : "border-border",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full",
                                          active ? "bg-background/15" : "bg-muted",
                                        )}
                                      >
                                        {active ? (
                                          <Check className="h-3.5 w-3.5" />
                                        ) : (
                                          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                                        )}
                                      </span>

                                      <div className="text-[13px] font-extrabold leading-none sm:text-sm">
                                        {fmtHourButton(s.start_at)}
                                      </div>
                                      <div
                                        className={cn(
                                          "mt-1 text-[10px] leading-none",
                                          active ? "text-background/80" : "text-muted-foreground",
                                        )}
                                      >
                                        Tap para seleccionar
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 rounded-2xl border bg-white p-3">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-muted/40 ring-1 ring-border">
                            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                          </span>

                          <div className="min-w-0">
                            <div className="text-[11px] text-muted-foreground sm:text-sm">
                              ⚠️ Las horas disponibles podrían agotarse. Agenda lo antes posible.
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
                              {selectedSlotStartISO ? (
                                <>
                                  Nuevo horario:{" "}
                                  <span className="font-semibold text-foreground">
                                    {fmtLongDate(selectedSlotStartISO)} · {fmtTime(selectedSlotStartISO)}
                                  </span>
                                </>
                              ) : (
                                "Elige un horario para continuar."
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {plan === "pro" ? (
                        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-900 sm:text-sm">
                          ✅ Plan Pro: luego podemos activar confirmación por WhatsApp automáticamente.
                        </div>
                      ) : null}

                      {isCanceled ? (
                        <div className="mt-3 text-[11px] text-muted-foreground sm:text-sm">
                          Esta cita está cancelada; no se puede reagendar.
                        </div>
                      ) : null}

                      <div className="mt-3 text-[10px] text-muted-foreground sm:text-xs">
                        💡 Si este enlace fue compartido por error, crea una nueva reserva y usa el nuevo correo.
                      </div>
                    </div>
                  </>
                )}
              </section>
            </>
          ) : null}
        </div>

        {/* CTA fija mobile (ShimmerButton se mantiene ✅) */}
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-2 backdrop-blur sm:hidden">
          <div className="mx-auto w-full max-w-[460px] px-1">
            <div className="mb-2 rounded-2xl border bg-white px-3 py-2 text-[10.5px] text-muted-foreground">
              {selectedSlotStartISO ? (
                <div className="truncate">
                  <span className="font-semibold text-foreground">
                    Nuevo horario:
                  </span>{" "}
                  {fmtLongDate(selectedSlotStartISO)} · {fmtTime(selectedSlotStartISO)}
                </div>
              ) : (
                <div className="truncate">Elige un horario para continuar.</div>
              )}
            </div>

            <ShimmerButton
              type="button"
              variant="brand"
              onClick={onReschedulePickSlot}
              disabled={
                busy !== null || isCanceled || isLocked3h || !selectedSlotStartISO
              }
              className="w-full min-w-0 h-10 text-[12px]"
            >
              {busy === "reschedule"
                ? "Guardando..."
                : isCanceled
                  ? "No disponible"
                  : isLocked3h
                    ? "Bloqueado"
                    : "Guardar reagendamiento"}
            </ShimmerButton>

            <div className="h-[calc(env(safe-area-inset-bottom,0px)+4px)]" />
          </div>
        </div>
      </div>
    </main>
  );
}

function PageSkeleton() {
  return (
    <main className="min-h-screen overflow-x-clip bg-gradient-to-b from-background to-muted/40">
      <div className="mx-auto w-full max-w-[460px] px-3 py-10 font-[system-ui] text-[12px] sm:max-w-3xl sm:px-4 sm:text-[14px] lg:max-w-6xl lg:px-6">
        <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="h-6 w-44 rounded bg-muted/60 animate-pulse" />
          <div className="mt-3 h-4 w-72 rounded bg-muted/60 animate-pulse" />
          <div className="mt-6 grid gap-3">
            <div className="h-24 rounded-2xl bg-muted/60 animate-pulse" />
            <div className="h-20 rounded-2xl bg-muted/60 animate-pulse" />
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