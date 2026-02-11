"use client";

import { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  ChevronLeft,
  ChevronRight,
  X,
  CalendarDays,
  User,
  Mail,
  Phone,
  ShieldCheck,
  BadgeCheck,
} from "lucide-react";

type Slot = { start_at: string; end_at: string };

type Professional = {
  id: string;
  name: string;
  title?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
};

type Service = {
  id: string;
  tenant_id: string;
  name: string;
  duration_min: number | null;
  price: number | null;
  currency: string | null;
  is_active?: boolean | null;
};

const tz = "America/Santiago";
const PAGE_SIZE = 7;
const MAX_DAYS_AHEAD = 60;

// ✅ default lead time (fallback)
const DEFAULT_MIN_LEAD_TIME_MIN = 120; // 2 horas

function formatCL(dateISO: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateISO));
}

function onlyTimeCL(dateISO: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateISO));
}

function dayLabelCL(dayKey: string) {
  const d = new Date(`${dayKey}T12:00:00`);
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    weekday: "long",
    day: "2-digit",
    month: "short",
  }).format(d);
}

function dayKeyCL(iso: string) {
  const d = new Date(iso);
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

function slotBucketLabel(iso: string): "Mañana" | "Tarde" | "Noche" {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso)),
  );
  if (hour < 12) return "Mañana";
  if (hour < 18) return "Tarde";
  return "Noche";
}

function normalizeCLPhone(input: string) {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.length === 9 && digits.startsWith("9")) return `+56${digits}`;

  return digits ? `+${digits}` : trimmed;
}

/**
 * ✅ Validación estricta Chile (móvil)
 * Acepta:
 * - 9XXXXXXXX (9 dígitos, parte con 9)
 * - +569XXXXXXXX (o 569XXXXXXXX)
 */
function isValidCLMobile(input: string) {
  const raw = input.trim();
  if (!raw) return false;

  const digits = raw.replace(/\D/g, ""); // solo números

  // Caso: 9 dígitos y parte con 9 (móvil sin país)
  if (digits.length === 9 && digits.startsWith("9")) return true;

  // Caso: con país 56 + 9 dígitos (total 11) y parte "569"
  if (digits.length === 11 && digits.startsWith("569")) return true;

  return false;
}

/**
 * ✅ Normaliza a +569XXXXXXXX cuando sea válido
 * Si no es válido, no fuerza formato.
 */
function normalizeToE164CLMobile(input: string) {
  const digits = input.trim().replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("9")) return `+56${digits}`;
  if (digits.length === 11 && digits.startsWith("569")) return `+${digits}`;
  return input.trim();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function moneyCLP(price: number, currency?: string | null) {
  const cur = (currency || "").toUpperCase();
  if (cur === "CLP" || !cur)
    return `$${Math.round(price).toLocaleString("es-CL")} CLP`;
  return `${price} ${cur}`;
}

function buildPageDays(pageStart: number) {
  const base = new Date();
  base.setHours(12, 0, 0, 0);

  return Array.from({ length: PAGE_SIZE }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + pageStart + i);
    const key = dayKeyCL(d.toISOString());
    return { dayKey: key, label: dayLabelCL(key) };
  });
}

function ReservarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tenantSlug, setTenantSlug] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [tenantFromQuery, setTenantFromQuery] = useState<string>("");

  // ✅ UI alerts
  const [serviceAlert, setServiceAlert] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);

  useEffect(() => {
    const qTenant = searchParams.get("tenant") || "";
    const qService = searchParams.get("service") || "";
    setTenantFromQuery(qTenant);
    setServiceId(qService);

    if (qTenant) {
      setTenantSlug(qTenant);
      return;
    }

    const host = window.location.hostname.split(":")[0].toLowerCase();
    const fromSubdomain = host.endsWith(".citaya.online")
      ? host.replace(".citaya.online", "").split(".")[0]
      : "";

    setTenantSlug(fromSubdomain || "");
  }, [searchParams]);

  const [tenantId, setTenantId] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");

  // ✅ NUEVO: lead time por-tenant (fallback 120)
  const [minLeadTimeMin, setMinLeadTimeMin] = useState<number>(
    DEFAULT_MIN_LEAD_TIME_MIN,
  );

  const [daysAhead] = useState<number>(
    Math.max(31, MAX_DAYS_AHEAD + PAGE_SIZE),
  );
  const [pageStart, setPageStart] = useState<number>(0);

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [professionalId, setProfessionalId] = useState<string>("");
  const [loadingPros, setLoadingPros] = useState(false);

  const [services, setServices] = useState<Service[]>([]);
  const [service, setService] = useState<Service | null>(null);
  const [loadingServices, setLoadingServices] = useState(false);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [selectedDayKey, setSelectedDayKey] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const phoneNorm = useMemo(() => normalizeCLPhone(phone), [phone]);
  const isPhoneValid = useMemo(() => isValidCLMobile(phone), [phone]);

  const isProd = process.env.NODE_ENV === "production";

  useEffect(() => {
    if (!tenantSlug) {
      setTenantId("");
      setTenantName("");
      setMinLeadTimeMin(DEFAULT_MIN_LEAD_TIME_MIN);
      setLoadError("Falta tenant en la URL (subdominio o ?tenant=).");
    }
  }, [tenantSlug]);

  // 1) Cargar tenant_id por slug
  useEffect(() => {
    if (!tenantSlug) return;

    let cancelled = false;

    (async () => {
      try {
        setLoadError(null);

        const res = await fetch(
          `/api/tenants/by-slug?slug=${encodeURIComponent(tenantSlug)}`,
          { cache: "no-store" },
        );
        const json = await res.json();

        if (!res.ok) throw new Error(json?.error ?? "No se pudo cargar tenant");

        if (!cancelled) {
          setTenantId(json?.tenant?.id ?? "");
          setTenantName(json?.tenant?.name ?? "");

          // ✅ NUEVO: setear lead time por-tenant
          setMinLeadTimeMin(
            typeof json?.tenant?.min_lead_time_min === "number"
              ? json.tenant.min_lead_time_min
              : DEFAULT_MIN_LEAD_TIME_MIN,
          );
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setTenantId("");
          setTenantName("");
          setMinLeadTimeMin(DEFAULT_MIN_LEAD_TIME_MIN);
          setLoadError(e?.message ?? "No se pudo cargar tenant");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  // 2) Cargar profesionales por tenant
  useEffect(() => {
    if (!tenantSlug) return;

    let cancelled = false;
    setLoadingPros(true);

    (async () => {
      try {
        const res = await fetch(
          `/api/professionals/by-tenant?tenant=${encodeURIComponent(tenantSlug)}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (!res.ok)
          throw new Error(json?.error ?? "No se pudieron cargar profesionales");

        const list = (Array.isArray(json) ? json : []) as Professional[];

        if (cancelled) return;

        setProfessionals(list);

        setProfessionalId((prev) => {
          const exists = !!prev && list.some((p) => p.id === prev);
          return exists ? prev : (list[0]?.id ?? "");
        });
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setProfessionals([]);
          setProfessionalId("");
          setLoadError(
            (prev) =>
              prev ?? "No se pudieron cargar profesionales del negocio.",
          );
        }
      } finally {
        if (!cancelled) setLoadingPros(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  // 3) Cargar servicios por tenant
  useEffect(() => {
    if (!tenantSlug) return;

    let cancelled = false;
    setLoadingServices(true);

    (async () => {
      try {
        setLoadError(null);

        const res = await fetch(
          `/api/services/by-tenant?tenant=${encodeURIComponent(tenantSlug)}`,
          { cache: "no-store" },
        );
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json?.error ?? "No se pudieron cargar servicios.");
        }

        const list = (
          Array.isArray(json?.services) ? json.services : []
        ) as Service[];
        if (cancelled) return;

        setServices(list);

        if (serviceId) {
          const found = list.find((s) => s.id === serviceId) ?? null;
          setService(found ?? list[0] ?? null);
        } else {
          setService(null);
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setServices([]);
          setService(null);
          setLoadError(
            (prev) => prev ?? e?.message ?? "No se pudieron cargar servicios.",
          );
        }
      } finally {
        if (!cancelled) setLoadingServices(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug, serviceId]);

  // ✅ limpiar alert si ya eligió servicio
  useEffect(() => {
    if (serviceId) setServiceAlert(null);
  }, [serviceId]);

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);
    to.setDate(to.getDate() + daysAhead);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }, [daysAhead]);

  const professionalName = useMemo(() => {
    return (
      professionals.find((p) => p.id === professionalId)?.name ?? "Profesional"
    );
  }, [professionals, professionalId]);

  const durationMin = service?.duration_min ?? 30;

  const availabilityUrl = useMemo(() => {
    if (!tenantId || !professionalId) return "";
    if (!serviceId) return ""; // ✅ no cargar slots sin servicio

    const p = new URLSearchParams();
    p.set("tenantId", tenantId);
    p.set("professionalId", professionalId);
    p.set("from", range.from);
    p.set("to", range.to);
    p.set("durationMin", String(durationMin));
    p.set("serviceId", serviceId);

    return `/api/appointments/availability?${p.toString()}`;
  }, [tenantId, professionalId, range.from, range.to, durationMin, serviceId]);

  const loadSlots = useCallback(async () => {
    if (!tenantId) return;
    if (!professionalId) return;

    // ✅ guard: sin servicio no tiene sentido cargar disponibilidad
    if (!availabilityUrl) {
      setSlots([]);
      setSelectedSlot(null);
      const pageDays = buildPageDays(pageStart);
      setSelectedDayKey(pageDays[0]?.dayKey ?? "");
      return;
    }

    setLoadingSlots(true);
    setLoadError(null);
    setSelectedSlot(null);

    try {
      const res = await fetch(availabilityUrl, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Error cargando slots");

      const list = Array.isArray(json?.slots) ? (json.slots as Slot[]) : [];
      setSlots(list);

      const pageDays = buildPageDays(pageStart);
      setSelectedDayKey(pageDays[0]?.dayKey ?? "");
    } catch (e: any) {
      console.error(e);
      setSlots([]);
      setLoadError(e?.message ?? "No se pudo cargar disponibilidad");
      const pageDays = buildPageDays(pageStart);
      setSelectedDayKey(pageDays[0]?.dayKey ?? "");
    } finally {
      setLoadingSlots(false);
    }
  }, [tenantId, professionalId, availabilityUrl, pageStart]);

  useEffect(() => {
    if (!tenantId) return;
    if (!professionalId) return;
    if (!availabilityUrl) return;
    loadSlots();
  }, [tenantId, professionalId, availabilityUrl, loadSlots]);

  // Map dayKey -> slots
  const slotsByDayKey = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = dayKeyCL(s.start_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
      map.set(k, arr);
    }
    return map;
  }, [slots]);

  const visibleDays = useMemo(() => buildPageDays(pageStart), [pageStart]);

  useEffect(() => {
    if (visibleDays.length === 0) return;

    if (!selectedDayKey) {
      setSelectedDayKey(visibleDays[0].dayKey);
      return;
    }

    const inPage = visibleDays.some((d) => d.dayKey === selectedDayKey);
    if (!inPage) setSelectedDayKey(visibleDays[0].dayKey);
  }, [visibleDays, selectedDayKey]);

  // ✅ slots del día seleccionado filtrados por lead time por-tenant
  const activeSlots: Slot[] = useMemo(() => {
    if (!selectedDayKey) return [];

    const list = slotsByDayKey.get(selectedDayKey) ?? [];
    const minTs = Date.now() + (minLeadTimeMin || 0) * 60_000;

    return list.filter((slot) => new Date(slot.start_at).getTime() >= minTs);
  }, [slotsByDayKey, selectedDayKey, minLeadTimeMin]);

  // ✅ buckets (necesario para el render)
  const buckets = useMemo(() => {
    const b: Record<"Mañana" | "Tarde" | "Noche", Slot[]> = {
      Mañana: [],
      Tarde: [],
      Noche: [],
    };

    for (const slot of activeSlots) {
      const key = slotBucketLabel(slot.start_at);
      b[key].push(slot);
    }

    return b;
  }, [activeSlots]);

  // ✅ condiciones de submit (ahora teléfono debe ser válido CL móvil)
  const canSubmit =
    !!serviceId &&
    !!service &&
    !!selectedSlot &&
    !!tenantId &&
    !!professionalId &&
    fullName.trim().length >= 2 &&
    isPhoneValid &&
    isValidEmail(email) &&
    !saving;

  const handleReserve = async () => {
    // ✅ alerta visible + scroll natural (sin meter refs)
    if (!serviceId || !service) {
      setServiceAlert(
        "Debes seleccionar un servicio antes de ver horarios y agendar.",
      );
      alert("Debes seleccionar un servicio antes de agendar.");
      return;
    }

    if (!selectedSlot) {
      alert("Selecciona un horario disponible.");
      return;
    }

    if (!tenantId) {
      alert("No se pudo identificar el tenant.");
      return;
    }

    if (!professionalId) {
      alert("Selecciona un profesional.");
      return;
    }

    if (!isValidCLMobile(phone)) {
      setPhoneTouched(true);
      alert("Celular inválido. Usa 9 dígitos (9XXXXXXXX) o +569XXXXXXXX.");
      return;
    }

    if (!isValidEmail(email)) {
      alert("Correo inválido.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        tenantId: tenantId,
        professionalId: professionalId,

        startAt: selectedSlot.start_at,
        endAt: selectedSlot.end_at,

        // snapshot cliente
        customerName: fullName.trim(),
        customerPhone: normalizeToE164CLMobile(phoneNorm.trim()),
        customerEmail: email.trim(),

        // relación opcional
        customerId: null,

        // snapshot servicio (lo copia el backend)
        serviceId: serviceId || null,

        status: "confirmed",
        currency: (service?.currency || "CLP").toUpperCase(),

        // notes si quieres
        notes: null,
      };

      const res = await fetch("/api/appointments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "No se pudo crear la cita");

      const appointmentId = json?.appointmentId;
      const manageToken = json?.manageToken;

      if (!appointmentId)
        throw new Error("Reserva creada pero falta id en respuesta.");

      const qs = new URLSearchParams({ id: appointmentId }).toString();

      if (manageToken) {
        try {
          sessionStorage.setItem(
            `citaya_manage_token:${appointmentId}`,
            manageToken,
          );
        } catch {}
      }

      router.push(`/reservar/confirmacion?${qs}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Error reservando");
    } finally {
      setSaving(false);
    }
  };

  const canPrev = pageStart > 0;
  const canNext = pageStart + PAGE_SIZE < MAX_DAYS_AHEAD;

  const goPrev7 = () => {
    setPageStart((p) => Math.max(0, p - PAGE_SIZE));
    setSelectedSlot(null);
  };

  const goNext7 = () => {
    setPageStart((p) => {
      const maxStart = Math.max(0, MAX_DAYS_AHEAD - PAGE_SIZE);
      return Math.min(maxStart, p + PAGE_SIZE);
    });
    setSelectedSlot(null);
  };

  useEffect(() => {
    const days = buildPageDays(pageStart);
    if (days[0]?.dayKey) setSelectedDayKey(days[0].dayKey);
  }, [pageStart]);

  const onClose = () => router.push("/");

  const showServicePicker = !serviceId;

  const pickService = (id: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("service", id);
    if (tenantFromQuery) p.set("tenant", tenantFromQuery);
    router.push(`/reservar?${p.toString()}`);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <div className="mx-auto w-full max-w-[430px] px-3 pb-20 pt-3 font-[system-ui] text-[12px] leading-tight sm:max-w-2xl sm:px-4 sm:pb-16 sm:pt-4 sm:text-[14px] sm:leading-normal lg:max-w-6xl lg:px-6 lg:pb-24 lg:pt-6">
        {/* Header */}
        <div className="mb-2 flex items-start justify-between gap-2 sm:mb-3 lg:mb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-white/80 ring-1 ring-border sm:h-11 sm:w-11">
              <span className="text-[10px] font-extrabold sm:text-sm">
                {(tenantName || tenantSlug || "C").slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold sm:text-base">
                {tenantName || tenantSlug || "Reserva tu hora"}
              </div>
              <div className="text-[11px] text-muted-foreground sm:text-sm">
                Selecciona servicio, profesional y confirma.
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-2xl border bg-white/80 shadow-sm hover:bg-muted sm:h-10 sm:w-10"
            aria-label="Cerrar"
            title="Cerrar"
          >
            <X className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
        </div>

        {/* ✅ Alerta si no hay servicio seleccionado (UI, no solo alert()) */}
        {serviceAlert ? (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 sm:text-sm">
            <b>Atención:</b> {serviceAlert}
          </div>
        ) : null}

        {!isProd ? (
          <div className="mb-2 rounded-2xl border border-dashed bg-white/70 p-2 text-[10px] text-muted-foreground sm:mb-3 sm:p-3 sm:text-xs">
            <div>
              <b>tenant</b>: {tenantSlug || "—"}{" "}
              {tenantName ? `(${tenantName})` : ""}
            </div>
            <div>
              <b>tenantId</b>: {tenantId || "—"}
            </div>
            <div>
              <b>service</b>: {serviceId || "—"} · <b>duration</b>:{" "}
              {durationMin}m
            </div>
            <div>
              <b>professional</b>: {professionalId || "—"}
            </div>
            <div>
              <b>leadTime</b>: {minLeadTimeMin} min
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {/* Servicio */}
            <section className="rounded-2xl border bg-white/80 p-3 shadow-sm backdrop-blur sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold sm:text-base">
                    Servicio
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground sm:mt-1 sm:text-sm">
                    {showServicePicker
                      ? "Elige un servicio para continuar."
                      : "Detalles del servicio seleccionado."}
                  </div>
                </div>
              </div>

              {loadingServices ? (
                <div className="mt-3 h-12 rounded-xl bg-muted/50 animate-pulse" />
              ) : showServicePicker ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {services.length === 0 ? (
                    <div className="rounded-xl border bg-white p-3 text-[11px] text-muted-foreground sm:text-sm">
                      No hay servicios activos configurados.
                    </div>
                  ) : (
                    services.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => pickService(s.id)}
                        className="w-full rounded-2xl border bg-white p-3 text-left transition hover:bg-muted/40"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-muted/50 ring-1 ring-border">
                              <BadgeCheck className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[12px] font-extrabold sm:text-sm">
                                {s.name}
                              </div>
                              <div className="mt-0.5 text-[10.5px] text-muted-foreground sm:text-xs">
                                {s.duration_min ? `${s.duration_min} min` : "—"}
                                {typeof s.price === "number"
                                  ? ` · ${moneyCLP(s.price, s.currency)}`
                                  : ""}
                              </div>
                            </div>
                          </div>

                          <span className="shrink-0 rounded-xl bg-foreground px-3 py-2 text-[10px] font-extrabold text-background sm:text-xs">
                            Elegir
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-muted/50 ring-1 ring-border">
                        <BadgeCheck className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-extrabold sm:text-sm">
                          {service?.name ?? "Servicio seleccionado"}
                        </div>
                        <div className="mt-0.5 text-[10.5px] text-muted-foreground sm:text-xs">
                          {durationMin} min
                          {typeof service?.price === "number"
                            ? ` · ${moneyCLP(service.price!, service.currency)}`
                            : ""}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const p = new URLSearchParams(searchParams.toString());
                        p.delete("service");
                        router.push(`/reservar?${p.toString()}`);
                      }}
                      className="shrink-0 rounded-xl border bg-white px-3 py-2 text-[10px] font-extrabold hover:bg-muted sm:text-xs"
                      title="Cambiar servicio"
                    >
                      Cambiar
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Profesional */}
            <section className="mt-3 rounded-2xl border bg-white/80 p-3 shadow-sm backdrop-blur sm:mt-4 sm:p-4">
              <div className="mb-2 flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div className="text-[13px] font-semibold sm:text-base">
                  Profesional
                </div>
              </div>

              {loadingPros ? (
                <div className="h-14 rounded-xl bg-muted/50 animate-pulse sm:h-16" />
              ) : professionals.length === 0 ? (
                <div className="rounded-2xl border bg-white p-3 text-[12px] font-extrabold sm:text-sm">
                  Sin profesionales configurados
                  <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
                    Agrega profesionales en Supabase → <b>professionals</b>{" "}
                    (active=true).
                  </div>
                </div>
              ) : (
                <>
                  {professionals.length > 1 ? (
                    <select
                      value={professionalId}
                      disabled={saving || !tenantId}
                      onChange={(e) => setProfessionalId(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-white px-3 text-[12px] font-medium outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:text-sm"
                    >
                      {professionals.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {(() => {
                    const pro =
                      professionals.find((p) => p.id === professionalId) ??
                      professionals[0];
                    if (!pro) return null;

                    return (
                      <div className="mt-3 rounded-2xl border bg-white p-3 sm:p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-border sm:h-12 sm:w-12">
                            {pro.avatar_url ? (
                              <img
                                src={pro.avatar_url}
                                alt={pro.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-sm font-extrabold">
                                {pro.name.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-extrabold sm:text-sm">
                              {pro.name}
                            </div>
                            <div className="mt-0.5 text-[10.5px] text-muted-foreground sm:text-xs">
                              {pro.title || "Atención profesional"}
                            </div>
                            {pro.bio ? (
                              <div className="mt-1 line-clamp-2 text-[10.5px] text-muted-foreground sm:text-xs">
                                {pro.bio}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </section>

            {/* Fecha/Hora */}
            <section className="mt-3 rounded-2xl border bg-white/80 p-3 shadow-sm backdrop-blur sm:mt-4 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold sm:text-base">
                    Selecciona fecha y hora
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground sm:mt-1 sm:text-sm">
                    Solo horarios disponibles • Duración:{" "}
                    <span className="font-medium">{durationMin} min</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!serviceId) {
                      setServiceAlert(
                        "Selecciona un servicio para ver horarios.",
                      );
                      return;
                    }
                    loadSlots();
                  }}
                  disabled={
                    saving ||
                    loadingSlots ||
                    !tenantId ||
                    !professionalId ||
                    !serviceId
                  }
                  className="h-9 rounded-xl border bg-white px-3 text-[11px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:text-sm"
                >
                  {loadingSlots ? "Cargando..." : "Recargar"}
                </button>
              </div>

              {/* ✅ Aviso explícito si no hay servicio */}
              {!serviceId ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 sm:text-sm">
                  <b>Primero elige un servicio</b> para cargar disponibilidad.
                </div>
              ) : null}

              {loadError ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[11px] text-red-700 sm:text-sm">
                  {loadError}
                </div>
              ) : null}

              {/* ✅ Si no hay servicio, no mostramos el selector para evitar “No hay horarios” confuso */}
              {!serviceId ? null : (
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={goPrev7}
                      disabled={!canPrev}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border bg-white hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10"
                      title="Anterior"
                      aria-label="Anterior"
                    >
                      <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>

                    <div className="-mx-1 flex-1 overflow-x-auto px-1">
                      <div className="flex gap-2">
                        {visibleDays.map((d) => {
                          const active = d.dayKey === selectedDayKey;

                          // ✅ hasSlots considera lead time
                          const minTs =
                            Date.now() + (minLeadTimeMin || 0) * 60_000;
                          const hasSlots = (
                            slotsByDayKey.get(d.dayKey) ?? []
                          ).some(
                            (slot) =>
                              new Date(slot.start_at).getTime() >= minTs,
                          );

                          return (
                            <button
                              key={d.dayKey}
                              type="button"
                              onClick={() => {
                                setSelectedDayKey(d.dayKey);
                                setSelectedSlot(null);
                              }}
                              className={cn(
                                "whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-semibold ring-1 ring-border transition sm:px-4 sm:text-sm",
                                active
                                  ? "bg-foreground text-background"
                                  : "bg-white hover:bg-muted",
                                !hasSlots ? "opacity-80" : "",
                              )}
                            >
                              <span className="capitalize">{d.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={goNext7}
                      disabled={!canNext}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border bg-white hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10"
                      title="Siguiente"
                      aria-label="Siguiente"
                    >
                      <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  </div>

                  <div className="mt-4">
                    <div className="text-[11px] font-semibold sm:text-sm">
                      Selecciona una hora
                    </div>

                    {activeSlots.length === 0 ? (
                      <div className="mt-2 rounded-xl border bg-white p-3 text-[11px] text-muted-foreground sm:text-sm">
                        No hay horarios disponibles para este día.
                      </div>
                    ) : (
                      <div className="mt-2 grid gap-4">
                        {(["Mañana", "Tarde", "Noche"] as const).map(
                          (label) => {
                            const list = buckets[label] ?? [];
                            if (list.length === 0) return null;

                            return (
                              <div key={label}>
                                <div className="text-[10px] font-extrabold text-muted-foreground sm:text-xs">
                                  {label}
                                </div>

                                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                                  {list.map((s: Slot) => {
                                    const active =
                                      selectedSlot?.start_at === s.start_at;
                                    return (
                                      <button
                                        key={s.start_at}
                                        type="button"
                                        disabled={saving || !tenantId}
                                        onClick={() => setSelectedSlot(s)}
                                        className={cn(
                                          "h-9 rounded-xl text-[11px] font-semibold ring-1 ring-border transition sm:h-11 sm:text-sm",
                                          active
                                            ? "bg-foreground text-background"
                                            : "bg-white hover:bg-muted",
                                          saving || !tenantId
                                            ? "cursor-not-allowed opacity-60"
                                            : "",
                                        )}
                                      >
                                        {onlyTimeCL(s.start_at)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          },
                        )}
                      </div>
                    )}

                    <div className="mt-4 rounded-xl border bg-white p-3 text-[11px] sm:text-sm">
                      <div className="text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          Elegido:
                        </span>{" "}
                        {selectedSlot ? formatCL(selectedSlot.start_at) : "—"}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
                        Las horas podrían agotarse. Agenda lo antes posible.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Datos */}
            <section className="mt-3 rounded-2xl border bg-white/80 p-3 shadow-sm backdrop-blur sm:mt-4 sm:p-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <div className="text-[13px] font-semibold sm:text-base">
                  Datos de contacto
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground sm:text-sm">
                Te enviaremos la confirmación al correo.
              </div>

              <div className="mt-3 grid gap-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold sm:text-sm">
                    Nombre
                  </label>
                  <input
                    value={fullName}
                    disabled={saving || !tenantId}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="h-10 w-full rounded-xl border bg-white px-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold sm:text-sm">
                    Celular
                  </label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={phone}
                      disabled={saving || !tenantId}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (!phoneTouched) setPhoneTouched(true);
                      }}
                      onBlur={() => {
                        // ✅ si es válido, lo dejamos en +56
                        if (isValidCLMobile(phone)) {
                          setPhone(normalizeToE164CLMobile(phone));
                        }
                      }}
                      placeholder="Ej: 912345678 o +56912345678"
                      className={cn(
                        "h-10 w-full rounded-xl border bg-white pl-10 pr-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:text-sm",
                        phoneTouched && phone.trim().length > 0 && !isPhoneValid
                          ? "border-red-300 focus:ring-red-200"
                          : "focus:ring-foreground/20",
                      )}
                    />
                  </div>

                  <div className="mt-1.5 text-[10px] text-muted-foreground sm:text-xs">
                    Formato válido Chile móvil:{" "}
                    <span className="font-semibold text-foreground">
                      9XXXXXXXX
                    </span>{" "}
                    o{" "}
                    <span className="font-semibold text-foreground">
                      +569XXXXXXXX
                    </span>
                  </div>

                  <div className="mt-1.5 text-[10px] text-muted-foreground sm:text-xs">
                    Se guardará como:{" "}
                    <span className="font-semibold text-foreground">
                      {phoneNorm || "—"}
                    </span>
                  </div>

                  {phoneTouched && phone.trim().length > 0 && !isPhoneValid ? (
                    <div className="mt-1.5 text-[10px] text-red-600 sm:text-xs">
                      Celular inválido. Debe ser móvil Chile (9 dígitos) o +56.
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold sm:text-sm">
                    Correo
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={email}
                      disabled={saving || !tenantId}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Ej: nombre@gmail.com"
                      className={cn(
                        "h-10 w-full rounded-xl border bg-white pl-10 pr-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:text-sm",
                        email.trim().length > 0 && !isValidEmail(email)
                          ? "border-red-300 focus:ring-red-200"
                          : "focus:ring-foreground/20",
                      )}
                    />
                  </div>
                  {email.trim().length > 0 && !isValidEmail(email) ? (
                    <div className="mt-1.5 text-[10px] text-red-600 sm:text-xs">
                      Correo inválido.
                    </div>
                  ) : null}
                </div>

                <div className="text-center text-[10px] text-muted-foreground sm:text-xs">
                  Al reservar aceptas recibir mensajes relacionados a tu cita.
                </div>
              </div>
            </section>
          </div>

          {/* Sidebar */}
          <aside className="hidden lg:block lg:col-span-1">
            <section className="rounded-2xl border bg-white/80 p-4 shadow-sm backdrop-blur lg:sticky lg:top-6">
              <div className="mb-2 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <div className="text-base font-semibold">
                  Información de tu reserva
                </div>
              </div>

              <div className="mt-3 rounded-2xl border bg-white p-4">
                <div className="text-sm font-extrabold">
                  {service?.name ??
                    (serviceId ? "Servicio seleccionado" : "Servicio")}
                </div>

                <div className="mt-2 text-sm text-muted-foreground">
                  Profesional:{" "}
                  <span className="font-medium text-foreground">
                    {professionalName}
                  </span>
                </div>

                <div className="mt-1 text-sm text-muted-foreground">
                  Duración:{" "}
                  <span className="font-medium text-foreground">
                    {durationMin} min
                  </span>
                </div>

                {typeof service?.price === "number" ? (
                  <div className="mt-1 text-sm text-muted-foreground">
                    Precio:{" "}
                    <span className="font-extrabold text-foreground">
                      {moneyCLP(service.price, service.currency)}
                    </span>
                  </div>
                ) : null}

                <div className="mt-3 text-sm text-muted-foreground">
                  Fecha y hora:
                </div>
                <div className="mt-1 text-sm font-semibold">
                  {selectedSlot ? formatCL(selectedSlot.start_at) : "—"}
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleReserve}
                  disabled={!canSubmit}
                  className={cn(
                    "h-12 w-full rounded-2xl text-sm font-extrabold transition",
                    canSubmit
                      ? "bg-foreground text-background hover:opacity-95"
                      : "cursor-not-allowed bg-muted text-muted-foreground",
                  )}
                >
                  {saving ? "Reservando..." : "Confirmar reserva"}
                </button>

                {/* ✅ Hint extra si falta servicio */}
                {!serviceId ? (
                  <div className="mt-2 text-center text-[11px] text-amber-700">
                    Selecciona un servicio para habilitar la reserva.
                  </div>
                ) : null}
              </div>
            </section>
          </aside>
        </div>

        {/* CTA fija mobile */}
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-2 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={handleReserve}
            disabled={!canSubmit}
            className={cn(
              "h-11 w-full rounded-2xl text-[13px] font-extrabold transition",
              canSubmit
                ? "bg-foreground text-background hover:opacity-95"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            {saving ? "Reservando..." : "Confirmar reserva"}
          </button>

          {!serviceId ? (
            <div className="mt-1 text-center text-[11px] text-amber-700">
              Selecciona un servicio para continuar.
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function ReservarPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-[430px] px-3 py-10 font-[system-ui] text-[12px] sm:max-w-2xl sm:px-4 sm:text-[14px] lg:max-w-6xl lg:px-6">
          Cargando…
        </main>
      }
    >
      <ReservarInner />
    </Suspense>
  );
}
