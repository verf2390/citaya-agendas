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

function slotBucketLabel(iso: string) {
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

function ReservarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ✅ debug real (funciona en production con ?debug=1)
  const debug = searchParams.get("debug") === "1";

  // tenant
  const tenantFromQuery = searchParams.get("tenant") || "";
  const host =
    typeof window !== "undefined"
      ? window.location.hostname.split(":")[0].toLowerCase()
      : "";

  const tenantFromSubdomain = host.endsWith(".citaya.online")
    ? host.replace(".citaya.online", "").split(".")[0]
    : "";

  const tenantSlug = tenantFromQuery || tenantFromSubdomain;

  // service
  const serviceId = searchParams.get("service") || "";

  const [tenantId, setTenantId] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");

  const [daysAhead] = useState<number>(31);
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

  // form
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const phoneNorm = useMemo(() => normalizeCLPhone(phone), [phone]);

  // 0) Validación rápida de tenantSlug
  useEffect(() => {
    if (!tenantSlug) {
      setTenantId("");
      setTenantName("");
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

  // 2) Cargar profesionales por tenant (API server)
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

        // ✅ FIX sin loop: solo cambia professionalId si está vacío o ya no existe
        setProfessionalId((prev) => {
          const exists = !!prev && list.some((p) => p.id === prev);
          if (exists) return prev;
          return list[0]?.id ?? "";
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

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);
    to.setDate(to.getDate() + daysAhead);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [daysAhead]);

  const professionalName = useMemo(() => {
    return (
      professionals.find((p) => p.id === professionalId)?.name ?? "Profesional"
    );
  }, [professionals, professionalId]);

  const durationMin = service?.duration_min ?? 30;

  const availabilityUrl = useMemo(() => {
    if (!tenantId || !professionalId) return "";

    const p = new URLSearchParams();
    p.set("tenantId", tenantId);
    p.set("professionalId", professionalId);
    p.set("from", range.from);
    p.set("to", range.to);
    p.set("durationMin", String(durationMin));
    if (serviceId) p.set("serviceId", serviceId);

    return `/api/appointments/availability?${p.toString()}`;
  }, [tenantId, professionalId, range.from, range.to, durationMin, serviceId]);

  const loadSlots = async () => {
    if (!tenantId || !professionalId || !availabilityUrl) return;

    if (debug) console.log("[reservar] loading availability:", availabilityUrl);

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
        const key = dayKeyCL(first);
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
    if (!tenantId || !professionalId || !availabilityUrl) return;
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, professionalId, availabilityUrl, professionals.length]);

  // ... EL RESTO DE TU COMPONENTE NO CAMBIA ...
  // (desde grouped en adelante lo puedes dejar igual)

  // ✅ Solo cambia el panel debug:
  // antes: {!isProd ? (... ) : null}
  // ahora: {debug ? (... ) : null}

  // ↓↓↓ pega tu return original y reemplaza SOLO esta parte ↓↓↓

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <div className="mx-auto w-full max-w-[430px] px-3 pb-20 pt-3 font-[system-ui] text-[12px] leading-tight sm:max-w-2xl sm:px-4 sm:pb-16 sm:pt-4 sm:text-[14px] sm:leading-normal lg:max-w-6xl lg:px-6 lg:pb-24 lg:pt-6">
        {/* Header ... */}

        {debug ? (
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
            <div className="mt-1 break-all">
              <b>availabilityUrl</b>: {availabilityUrl || "—"}
            </div>
          </div>
        ) : null}

        {/* el resto igual */}
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
