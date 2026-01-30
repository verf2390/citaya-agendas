"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

const PROFESSIONALS = [
  { id: "f0e085dd-22ff-4c43-98bd-41eeaf9f4861", name: "Paola" },
  { id: "f143d73b-7ede-46a1-b288-76740224d679", name: "Gabriela" },
];

type Slot = { start_at: string; end_at: string };

function formatCL(dateISO: string) {
  const d = new Date(dateISO);
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function onlyTimeCL(dateISO: string) {
  const d = new Date(dateISO);
  return new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function dayLabelCL(dateISO: string) {
  const d = new Date(dateISO);
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  }).format(d);
}

function normalizeCLPhone(input: string) {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.length === 9 && digits.startsWith("9")) return `+56${digits}`;

  return digits ? `+${digits}` : trimmed;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function ReservarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tenantFromQuery = searchParams.get("tenant") || "";
  const host =
    typeof window !== "undefined"
      ? window.location.hostname.split(":")[0].toLowerCase()
      : "";
  const tenantFromSubdomain = host.endsWith(".citaya.online")
    ? host.replace(".citaya.online", "").split(".")[0]
    : "";

  const tenantSlug = tenantFromQuery || tenantFromSubdomain;
  const serviceId = searchParams.get("service") || "";

  const [tenantId, setTenantId] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");

  const [daysAhead] = useState<number>(31);

  const [pageStart, setPageStart] = useState<number>(0);
  const PAGE_SIZE = 7;

  const [professionalId, setProfessionalId] = useState(
    PROFESSIONALS[0]?.id ?? "",
  );
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
  const isProd = process.env.NODE_ENV === "production";

  useEffect(() => {
    if (!tenantSlug) {
      setTenantId("");
      setTenantName("");
      setLoadError("Falta tenant en la URL.");
      return;
    }

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
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setTenantId("");
          setTenantName("");
          setLoadError(e?.message ?? "No se pudo cargar tenant");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);
    to.setDate(to.getDate() + daysAhead);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [daysAhead]);

  const professionalName = useMemo(() => {
    return (
      PROFESSIONALS.find((p) => p.id === professionalId)?.name ?? "Profesional"
    );
  }, [professionalId]);

  const availabilityUrl = useMemo(() => {
    if (!tenantId || !professionalId) return "";
    return `/api/appointments/availability?tenantId=${encodeURIComponent(
      tenantId,
    )}&professionalId=${encodeURIComponent(
      professionalId,
    )}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(
      range.to,
    )}`;
  }, [tenantId, professionalId, range.from, range.to]);

  const loadSlots = async () => {
    if (!tenantId) return;
    if (!professionalId) return;
    if (!availabilityUrl) return;

    setLoadingSlots(true);
    setLoadError(null);
    setSelectedSlot(null);

    try {
      const res = await fetch(availabilityUrl, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Error cargando slots");

      const list = Array.isArray(json.slots) ? (json.slots as Slot[]) : [];
      setSlots(list);

      const first = list[0]?.start_at;
      if (first) {
        const d = new Date(first);
        const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
        setSelectedDayKey(key);
        setPageStart(0);
      } else {
        setSelectedDayKey("");
        setPageStart(0);
      }
    } catch (e: any) {
      console.error(e);
      setSlots([]);
      setLoadError(e?.message ?? "No se pudo cargar disponibilidad");
      setSelectedDayKey("");
      setPageStart(0);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, availabilityUrl, professionalId]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();

    for (const s of slots) {
      const d = new Date(s.start_at);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }

    const keys = Array.from(map.keys()).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    );

    return keys.map((k) => {
      const daySlots = map.get(k)!;
      daySlots.sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
      );
      return { dayKey: k, label: dayLabelCL(k), slots: daySlots };
    });
  }, [slots]);

  const visibleDays = useMemo(
    () => grouped.slice(pageStart, pageStart + PAGE_SIZE),
    [grouped, pageStart],
  );

  useEffect(() => {
    if (!grouped.length) return;

    if (!selectedDayKey) {
      setSelectedDayKey(grouped[0].dayKey);
      return;
    }

    const exists = grouped.some((d) => d.dayKey === selectedDayKey);
    if (!exists) {
      setSelectedDayKey(grouped[0].dayKey);
      setPageStart(0);
      return;
    }

    const idx = grouped.findIndex((d) => d.dayKey === selectedDayKey);
    const start = Math.floor(idx / PAGE_SIZE) * PAGE_SIZE;
    if (start !== pageStart) setPageStart(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped.length]);

  const activeDay = useMemo(
    () => grouped.find((d) => d.dayKey === selectedDayKey) ?? null,
    [grouped, selectedDayKey],
  );

  const activeSlots = activeDay?.slots ?? [];

  const canSubmit =
    !!selectedSlot &&
    !!tenantId &&
    fullName.trim().length >= 2 &&
    phoneNorm.trim().length >= 10 &&
    isValidEmail(email) &&
    !saving;

  const handleReserve = async () => {
    if (!selectedSlot) return;
    if (!tenantId) {
      alert("No se pudo identificar el tenant.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        tenant_id: tenantId,
        professional_id: professionalId,
        customer_name: fullName.trim(),
        customer_phone: phoneNorm.trim(),
        customer_email: email.trim(),
        start_at: selectedSlot.start_at,
        end_at: selectedSlot.end_at,
        status: "confirmed",
        service_id: serviceId || null,
      };

      const res = await fetch("/api/appointments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "No se pudo crear la cita");

      const appointmentId = json?.appointment?.id;
      const manageToken = json?.appointment?.manage_token;

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

  const goPrev7 = () => setPageStart((p) => Math.max(0, p - PAGE_SIZE));
  const goNext7 = () =>
    setPageStart((p) =>
      Math.min(Math.max(0, grouped.length - 1), p + PAGE_SIZE),
    );

  const canPrev = pageStart > 0;
  const canNext = pageStart + PAGE_SIZE < grouped.length;

  const onClose = () => router.push("/");

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      {/* ✅ “AgendaPro style” en móvil: más compacto + tipografía base más chica */}
      <div className="mx-auto w-full max-w-[430px] px-2 pb-20 pt-3 font-[system-ui] text-[12px] leading-tight sm:max-w-2xl sm:px-4 sm:pb-16 sm:pt-4 sm:text-[14px] sm:leading-normal lg:max-w-6xl lg:px-6 lg:pb-24 lg:pt-6">
        {/* Header */}
        <div className="mb-2 flex items-start justify-between gap-2 sm:mb-3 lg:mb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-2xl bg-white/80 ring-1 ring-border sm:h-11 sm:w-11">
              <span className="text-[10px] font-extrabold sm:text-sm">
                {(tenantName || tenantSlug || "C").slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold sm:text-base">
                {tenantName || tenantSlug || "Reserva tu hora"}
              </div>
              <div className="text-[10.5px] text-muted-foreground sm:text-sm">
                Selecciona fecha, profesional y confirma.
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-2xl border bg-white/80 shadow-sm hover:bg-muted sm:h-10 sm:w-10"
            aria-label="Cerrar"
            title="Cerrar"
          >
            <X className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
        </div>

        {/* Debug SOLO si NO es producción */}
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
              <b>service</b>: {serviceId || "—"}
            </div>
          </div>
        ) : null}

        <div className="grid gap-2 sm:gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {/* Fecha/Hora */}
            <section className="rounded-2xl border bg-white/80 p-2 shadow-sm backdrop-blur sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[12px] font-semibold sm:text-base">
                    Selecciona fecha y hora
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground sm:mt-1 sm:text-sm">
                    Solo horarios disponibles • Duración:{" "}
                    <span className="font-medium">30 min</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={loadSlots}
                  disabled={saving || loadingSlots || !tenantId}
                  className="h-7 rounded-xl border bg-white px-2 text-[10.5px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:px-3 sm:text-sm"
                >
                  {loadingSlots ? "Cargando..." : "Recargar"}
                </button>
              </div>

              {loadError ? (
                <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 sm:mt-3 sm:p-3 sm:text-sm">
                  {loadError}
                </div>
              ) : null}

              {!loadingSlots && !loadError && grouped.length === 0 ? (
                <div className="mt-2 rounded-xl border bg-white p-2 text-[11px] text-muted-foreground sm:mt-3 sm:p-3 sm:text-sm">
                  No hay horarios disponibles en este rango.
                </div>
              ) : null}

              {grouped.length > 0 ? (
                <div className="mt-2 sm:mt-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={goPrev7}
                      disabled={!canPrev}
                      className="flex h-7 w-7 items-center justify-center rounded-xl border bg-white hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10"
                      title="Anterior"
                      aria-label="Anterior"
                    >
                      <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>

                    <div className="-mx-1 flex-1 overflow-x-auto px-1">
                      <div className="flex gap-1.5 sm:gap-2">
                        {visibleDays.map((d) => {
                          const active = d.dayKey === selectedDayKey;
                          return (
                            <button
                              key={d.dayKey}
                              type="button"
                              onClick={() => {
                                setSelectedDayKey(d.dayKey);
                                setSelectedSlot(null);
                              }}
                              className={cn(
                                "whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ring-border transition sm:px-4 sm:py-2 sm:text-sm",
                                active
                                  ? "bg-foreground text-background"
                                  : "bg-white hover:bg-muted",
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
                      className="flex h-7 w-7 items-center justify-center rounded-xl border bg-white hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10"
                      title="Siguiente"
                      aria-label="Siguiente"
                    >
                      <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  </div>

                  {/* Horas */}
                  <div className="mt-2 sm:mt-4">
                    <div className="text-[10.5px] font-semibold sm:text-sm">
                      Selecciona una hora
                    </div>

                    {/* ✅ A54: 2 columnas se ve MUY AgendaPro (botones chicos pero ordenados) */}
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-3 sm:grid-cols-4">
                      {activeSlots.map((s) => {
                        const active = selectedSlot?.start_at === s.start_at;
                        return (
                          <button
                            key={s.start_at}
                            type="button"
                            disabled={saving || !tenantId}
                            onClick={() => setSelectedSlot(s)}
                            className={cn(
                              "h-7 rounded-xl text-[10px] font-semibold ring-1 ring-border transition sm:h-11 sm:text-sm",
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

                    <div className="mt-2 rounded-xl border bg-white p-2 text-[10.5px] sm:mt-4 sm:p-3 sm:text-sm">
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
              ) : null}
            </section>

            {/* Profesional */}
            <section className="mt-2 rounded-2xl border bg-white/80 p-2 shadow-sm backdrop-blur sm:mt-4 sm:p-4">
              <div className="mb-2 flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div className="text-[12px] font-semibold sm:text-base">
                  Profesional
                </div>
              </div>

              <select
                value={professionalId}
                disabled={saving || !tenantId}
                onChange={(e) => setProfessionalId(e.target.value)}
                className="h-9 w-full rounded-xl border bg-white px-3 text-[12px] font-medium outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:text-sm"
              >
                {PROFESSIONALS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <div className="mt-1.5 text-[10px] text-muted-foreground sm:text-xs">
                Tip: elige fecha/hora arriba y luego confirma.
              </div>
            </section>

            {/* Datos */}
            <section className="mt-2 rounded-2xl border bg-white/80 p-2 shadow-sm backdrop-blur sm:mt-4 sm:p-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <div className="text-[12px] font-semibold sm:text-base">
                  Datos de contacto
                </div>
              </div>

              <div className="text-[10.5px] text-muted-foreground sm:text-sm">
                Te enviaremos la confirmación al correo.
              </div>

              <div className="mt-2 grid gap-2 sm:mt-4 sm:gap-3">
                <div>
                  <label className="mb-1.5 block text-[10.5px] font-semibold sm:text-sm">
                    Nombre
                  </label>
                  <input
                    value={fullName}
                    disabled={saving || !tenantId}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="h-9 w-full rounded-xl border bg-white px-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10.5px] font-semibold sm:text-sm">
                    Celular
                  </label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={phone}
                      disabled={saving || !tenantId}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Ej: 912345678 o +56912345678"
                      className="h-9 w-full rounded-xl border bg-white pl-10 pr-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:text-sm"
                    />
                  </div>
                  <div className="mt-1.5 text-[10px] text-muted-foreground sm:text-xs">
                    Se guardará como:{" "}
                    <span className="font-semibold text-foreground">
                      {phoneNorm || "—"}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10.5px] font-semibold sm:text-sm">
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
                        "h-9 w-full rounded-xl border bg-white pl-10 pr-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:text-sm",
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

          {/* Sidebar (solo desktop) */}
          <aside className="hidden lg:block lg:col-span-1">
            <section className="rounded-2xl border bg-white/80 p-4 shadow-sm backdrop-blur lg:sticky lg:top-6">
              <div className="mb-2 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <div className="text-base font-semibold">
                  Información de tu reserva
                </div>
              </div>

              <div className="mt-3 rounded-2xl border bg-white p-4">
                <div className="text-sm font-semibold">
                  {serviceId ? `Servicio ${serviceId}` : "Servicio"}
                </div>

                <div className="mt-2 text-sm text-muted-foreground">
                  Profesional:{" "}
                  <span className="font-medium text-foreground">
                    {professionalName}
                  </span>
                </div>

                <div className="mt-1 text-sm text-muted-foreground">
                  Duración:{" "}
                  <span className="font-medium text-foreground">30 min</span>
                </div>

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
              </div>
            </section>
          </aside>
        </div>

        {/* CTA fija mobile (más compacta) */}
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-2 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={handleReserve}
            disabled={!canSubmit}
            className={cn(
              "h-10 w-full rounded-2xl text-[12px] font-extrabold transition sm:h-12 sm:text-sm",
              canSubmit
                ? "bg-foreground text-background hover:opacity-95"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            {saving ? "Reservando..." : "Confirmar reserva"}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function ReservarPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-[430px] px-2 py-10 font-[system-ui] text-[12px] sm:max-w-2xl sm:px-4 sm:text-[14px] lg:max-w-6xl lg:px-6">
          Cargando…
        </main>
      }
    >
      <ReservarInner />
    </Suspense>
  );
}
