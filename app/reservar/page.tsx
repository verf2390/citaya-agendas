"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type RefObject,
} from "react";
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
  Check,
  AlertTriangle,
  Sunrise,
  Sun,
  Moon,
  Sparkles,
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

function isValidCLMobile(input: string) {
  const raw = input.trim();
  if (!raw) return false;

  const digits = raw.replace(/\D/g, "");

  if (digits.length === 9 && digits.startsWith("9")) return true;
  if (digits.length === 11 && digits.startsWith("569")) return true;

  return false;
}

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

function SkeletonLine({ w = "w-full" }: { w?: string }) {
  return <div className={cn("h-3 rounded-lg bg-muted/60 animate-pulse", w)} />;
}

function SkeletonCard() {
  return (
    <div className="rounded-3xl border bg-white p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-muted/60 animate-pulse" />
        <div className="flex-1 space-y-2">
          <SkeletonLine w="w-2/3" />
          <SkeletonLine w="w-1/2" />
        </div>
        <div className="h-9 w-16 rounded-xl bg-muted/60 animate-pulse" />
      </div>
    </div>
  );
}

function useSmoothScrollTo() {
  const scrollToRef = <T extends HTMLElement>(ref: RefObject<T | null>) => {
    const el = ref.current;
    if (!el) return;

    try {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      el.scrollIntoView();
    }
  };

  return scrollToRef;
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
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white ring-1 ring-border shadow-sm">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-extrabold sm:text-base">
              {title}
            </div>
            {subtitle ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground sm:mt-1 sm:text-sm">
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

function BucketIcon({ label }: { label: "Mañana" | "Tarde" | "Noche" }) {
  if (label === "Mañana") return <Sunrise className="h-4 w-4" />;
  if (label === "Tarde") return <Sun className="h-4 w-4" />;
  return <Moon className="h-4 w-4" />;
}

function StepPill({
  step,
  label,
  active,
  done,
}: {
  step: string;
  label: string;
  active?: boolean;
  done?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold sm:text-xs",
        done
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : active
            ? "border-slate-300 bg-slate-900 text-white"
            : "border-slate-200 bg-white text-slate-500",
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
          done
            ? "bg-emerald-100 text-emerald-700"
            : active
              ? "bg-white/15 text-white"
              : "bg-slate-100 text-slate-500",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : step}
      </span>
      <span>{label}</span>
    </div>
  );
}

function ReservarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scrollToRef = useSmoothScrollTo();

  const serviceRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);

  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [tenantSlug, setTenantSlug] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [tenantFromQuery, setTenantFromQuery] = useState<string>("");

  const [serviceAlert, setServiceAlert] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

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

  useEffect(() => {
    if (!tenantSlug) {
      setTenantId("");
      setTenantName("");
      setMinLeadTimeMin(DEFAULT_MIN_LEAD_TIME_MIN);
      setLoadError("Falta tenant en la URL (subdominio o ?tenant=).");
    }
  }, [tenantSlug]);

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
            (prev) => prev ?? "No se pudieron cargar profesionales del negocio.",
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

        if (!res.ok)
          throw new Error(json?.error ?? "No se pudieron cargar servicios.");

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

  useEffect(() => {
    if (serviceId) setServiceAlert(null);
  }, [serviceId]);

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
    if (!serviceId) return "";

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

  const activeSlots: Slot[] = useMemo(() => {
    if (!selectedDayKey) return [];
    const list = slotsByDayKey.get(selectedDayKey) ?? [];
    const minTs = Date.now() + (minLeadTimeMin || 0) * 60_000;
    return list.filter((slot) => new Date(slot.start_at).getTime() >= minTs);
  }, [slotsByDayKey, selectedDayKey, minLeadTimeMin]);

  const buckets = useMemo(() => {
    const b: Record<"Mañana" | "Tarde" | "Noche", Slot[]> = {
      Mañana: [],
      Tarde: [],
      Noche: [],
    };
    for (const slot of activeSlots)
      b[slotBucketLabel(slot.start_at)].push(slot);
    return b;
  }, [activeSlots]);

  const bucketCounts = useMemo(() => {
    return {
      Mañana: buckets.Mañana?.length ?? 0,
      Tarde: buckets.Tarde?.length ?? 0,
      Noche: buckets.Noche?.length ?? 0,
    };
  }, [buckets]);

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
    if (!serviceId || !service) {
      setServiceAlert(
        "Debes seleccionar un servicio antes de ver horarios y agendar.",
      );
      alert("Debes seleccionar un servicio antes de agendar.");
      scrollToRef(serviceRef);
      return;
    }

    if (!selectedSlot) {
      alert("Selecciona un horario disponible.");
      scrollToRef(slotRef);
      return;
    }

    if (!tenantId) {
      alert("No se pudo identificar el tenant.");
      return;
    }

    if (!professionalId) {
      alert("Selecciona un profesional.");
      scrollToRef(serviceRef);
      return;
    }

    if (!isValidCLMobile(phone)) {
      setPhoneTouched(true);
      alert("Celular inválido. Usa 9 dígitos (9XXXXXXXX) o +569XXXXXXXX.");
      scrollToRef(contactRef);
      return;
    }

    if (!isValidEmail(email)) {
      setEmailTouched(true);
      alert("Correo inválido.");
      scrollToRef(contactRef);
      return;
    }

    if (fullName.trim().length < 2) {
      setNameTouched(true);
      alert("Ingresa tu nombre.");
      scrollToRef(contactRef);
      return;
    }

    setSaving(true);

    try {
      const payload = {
        tenantId,
        professionalId,

        startAt: selectedSlot.start_at,
        endAt: selectedSlot.end_at,

        customerName: fullName.trim(),
        customerPhone: normalizeToE164CLMobile(phoneNorm.trim()),
        customerEmail: email.trim().toLowerCase(),

        customerId: null,
        serviceId: serviceId || null,

        status: "confirmed",
        currency: (service?.currency || "CLP").toUpperCase(),

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
    setTimeout(() => scrollToRef(slotRef), 80);
  };

  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const minTs = Date.now() + (minLeadTimeMin || 0) * 60_000;
    for (const d of visibleDays) {
      const list = slotsByDayKey.get(d.dayKey) ?? [];
      const n = list.filter((s) => new Date(s.start_at).getTime() >= minTs)
        .length;
      counts.set(d.dayKey, n);
    }
    return counts;
  }, [visibleDays, slotsByDayKey, minLeadTimeMin]);

  const mobileSummary = useMemo(() => {
    const svc =
      service?.name ?? (serviceId ? "Servicio seleccionado" : "Servicio");
    const time = selectedSlot ? formatCL(selectedSlot.start_at) : "—";
    const price =
      typeof service?.price === "number"
        ? moneyCLP(service.price, service.currency)
        : null;
    return { svc, time, price };
  }, [service, serviceId, selectedSlot]);

  const lockSlots = !serviceId || !tenantId || !professionalId;
  const lockContact = !selectedSlot || !tenantId;

  const slotsPanelKey = useMemo(() => {
    return `${selectedDayKey}:${professionalId}:${serviceId}:${pageStart}`;
  }, [selectedDayKey, professionalId, serviceId, pageStart]);

  const serviceDone = !!serviceId;
  const slotDone = !!selectedSlot;
  const contactDone =
    fullName.trim().length >= 2 && isPhoneValid && isValidEmail(email);

  return (
    <main className="min-h-screen overflow-x-clip bg-[radial-gradient(circle_at_top,rgba(255,255,255,1),rgba(248,250,252,1)_42%,rgba(241,245,249,1)_100%)]">
      <div className="mx-auto w-full max-w-[460px] px-3 pb-28 pt-2 font-[system-ui] text-[12px] leading-snug sm:max-w-3xl sm:px-4 sm:pb-16 sm:pt-4 sm:text-[14px] sm:leading-normal lg:max-w-6xl lg:px-6 lg:pb-24 lg:pt-6">
        <div
          className={cn(
            "sticky top-0 z-40 -mx-3 px-3 pb-2 pt-2 sm:-mx-4 sm:px-4 lg:static lg:mx-0 lg:px-0 lg:pt-0",
            "bg-background/90 backdrop-blur-xl",
            isScrolled ? "border-b shadow-sm" : "border-b border-transparent",
          )}
        >
          <div className="rounded-[28px] border border-border/70 bg-white/90 px-3 py-3 shadow-sm sm:px-4 sm:py-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-border shadow-sm sm:h-11 sm:w-11">
                  <span className="text-[10px] font-extrabold sm:text-sm">
                    {(tenantName || tenantSlug || "C").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-extrabold sm:text-lg">
                    {tenantName || tenantSlug || "Reserva tu hora"}
                  </div>
                  <div className="text-[11px] text-muted-foreground sm:text-sm">
                    Reserva en pocos pasos • confirmación automática
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-2xl border bg-white shadow-sm transition hover:bg-muted sm:h-10 sm:w-10"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <StepPill step="1" label="Servicio" active={!serviceDone} done={serviceDone} />
              <StepPill
                step="2"
                label="Horario"
                active={serviceDone && !slotDone}
                done={slotDone}
              />
              <StepPill
                step="3"
                label="Datos"
                active={slotDone && !contactDone}
                done={contactDone}
              />
            </div>

            {!selectedSlot ? (
              <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-[10.5px] text-muted-foreground sm:text-xs">
                Elige un servicio, selecciona la hora y confirma tus datos.
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10.5px] text-emerald-800 sm:text-xs">
                Hora elegida:{" "}
                <span className="font-extrabold">
                  {formatCL(selectedSlot.start_at)}
                </span>
              </div>
            )}

            {serviceAlert ? (
              <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 sm:p-2.5 sm:text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <div>
                    <b>Atención:</b> {serviceAlert}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 pt-3 sm:gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div ref={serviceRef} />
            <section className="rounded-[28px] border border-border/80 bg-white/90 p-3 shadow-sm backdrop-blur sm:p-5">
              <SectionHeader
                icon={<BadgeCheck className="h-4 w-4 text-muted-foreground" />}
                title="Servicio"
                subtitle={
                  showServicePicker
                    ? "Elige el servicio para seguir con la reserva."
                    : "Este es el servicio que estás por agendar."
                }
              />

              {loadingServices ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : showServicePicker ? (
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  {services.length === 0 ? (
                    <div className="rounded-2xl border bg-white p-3 text-[11px] text-muted-foreground sm:text-sm">
                      No hay servicios activos configurados.
                    </div>
                  ) : (
                    services.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => pickService(s.id)}
                        className={cn(
                          "w-full rounded-3xl border bg-white p-3 text-left transition",
                          "hover:bg-slate-50 hover:shadow-md active:scale-[0.99]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-border">
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

                          <span className="shrink-0 rounded-2xl bg-slate-900 px-3 py-2 text-[10px] font-extrabold text-white shadow-sm sm:text-xs">
                            Elegir
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                        <BadgeCheck className="h-5 w-5" />
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

                    <div className="flex justify-start">
                      <button
                        type="button"
                        onClick={() => {
                          const p = new URLSearchParams(searchParams.toString());
                          p.delete("service");
                          router.push(`/reservar?${p.toString()}`);
                          setTimeout(() => scrollToRef(serviceRef), 60);
                        }}
                        className={cn(
                          "inline-flex items-center gap-2",
                          "h-10 rounded-2xl border bg-white px-4 text-[12px] font-extrabold text-slate-900 shadow-sm",
                          "hover:bg-slate-50 active:scale-[0.99]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                        title="Cambiar servicio"
                      >
                        <X className="h-4 w-4 shrink-0" />
                        <span className="whitespace-nowrap">Cambiar servicio</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="mt-3 rounded-[28px] border border-border/80 bg-white/90 p-3 shadow-sm backdrop-blur sm:p-5">
              <SectionHeader
                icon={<User className="h-4 w-4 text-muted-foreground" />}
                title="Profesional"
                subtitle="Selecciona quién te atenderá."
              />

              {loadingPros ? (
                <div className="mt-3 rounded-3xl border bg-white p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-2xl bg-muted/60 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <SkeletonLine w="w-1/2" />
                      <SkeletonLine w="w-2/3" />
                    </div>
                  </div>
                </div>
              ) : professionals.length === 0 ? (
                <div className="mt-3 rounded-3xl border bg-white p-3 text-[12px] font-extrabold sm:text-sm">
                  Sin profesionales configurados
                  <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
                    Agrega profesionales en Supabase → <b>professionals</b> (active=true).
                  </div>
                </div>
              ) : (
                <>
                  {professionals.length > 1 ? (
                    <select
                      value={professionalId}
                      disabled={saving || !tenantId}
                      onChange={(e) => setProfessionalId(e.target.value)}
                      className="mt-3 h-11 w-full rounded-2xl border bg-white px-3 text-[12px] font-medium outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
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
                      <div className="mt-3 rounded-3xl border bg-gradient-to-br from-white to-slate-50 p-3 sm:p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-border">
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

            <div ref={slotRef} />
            <section
              className={cn(
                "mt-3 rounded-[28px] border border-border/80 bg-white/90 p-3 shadow-sm backdrop-blur sm:p-5",
                lockSlots ? "opacity-70" : "",
              )}
            >
              <SectionHeader
                icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
                title="Selecciona fecha y hora"
                subtitle={`Solo horarios disponibles • Duración: ${durationMin} min`}
                right={
                  <button
                    type="button"
                    onClick={() => {
                      if (!serviceId) {
                        setServiceAlert("Selecciona un servicio para ver horarios.");
                        scrollToRef(serviceRef);
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
                    className={cn(
                      "h-9 rounded-2xl border bg-white px-3 text-[11px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:text-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    {loadingSlots ? "Cargando..." : "Recargar"}
                  </button>
                }
              />

              {!serviceId ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 sm:text-sm">
                  <b>Primero elige un servicio</b> para cargar disponibilidad.
                </div>
              ) : null}

              {loadError ? (
                <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-[11px] text-red-700 sm:text-sm">
                  {loadError}
                </div>
              ) : null}

              {lockSlots ? (
                <div className="mt-3 rounded-2xl border bg-white p-3 text-[11px] text-muted-foreground sm:text-sm">
                  Selecciona un <b>servicio</b> para ver horarios.
                </div>
              ) : (
                <div className="mt-3">
                  <div className="relative">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={goPrev7}
                        disabled={!canPrev}
                        className={cn(
                          "shrink-0 flex h-10 w-10 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                        title="Anterior"
                        aria-label="Anterior"
                      >
                        <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>

                      <div className="relative flex-1 min-w-0 w-0">
                        <div
                          aria-hidden
                          className="pointer-events-none absolute left-0 top-0 h-full w-6 bg-gradient-to-r from-background/90 to-transparent"
                        />
                        <div
                          aria-hidden
                          className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-background/90 to-transparent"
                        />

                        <div className="overflow-x-auto touch-pan-x overscroll-x-contain [-webkit-overflow-scrolling:touch]">
                          <div className="flex min-w-max flex-nowrap items-center gap-2 py-0.5">
                            {visibleDays.map((d) => {
                              const active = d.dayKey === selectedDayKey;
                              const n = dayCounts.get(d.dayKey) ?? 0;

                              return (
                                <button
                                  key={d.dayKey}
                                  type="button"
                                  onClick={() => {
                                    setSelectedDayKey(d.dayKey);
                                    setSelectedSlot(null);
                                  }}
                                  className={cn(
                                    "shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-[10px] font-semibold ring-1 ring-border transition",
                                    "sm:px-4 sm:py-2 sm:text-sm",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    active
                                      ? "bg-slate-900 text-white shadow-sm"
                                      : "bg-white hover:bg-muted",
                                    n === 0 ? "opacity-70" : "",
                                  )}
                                >
                                  <span className="capitalize">{d.label}</span>
                                  <span
                                    className={cn(
                                      "ml-1 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-extrabold",
                                      active
                                        ? "bg-white/15 text-white"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {n === 0 ? "—" : n >= 9 ? "9+" : n}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={goNext7}
                        disabled={!canNext}
                        className={cn(
                          "shrink-0 flex h-10 w-10 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                        title="Siguiente"
                        aria-label="Siguiente"
                      >
                        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>
                    </div>
                  </div>

                  <div
                    key={slotsPanelKey}
                    className={cn(
                      "mt-4 animate-in fade-in-0 duration-200",
                      "motion-reduce:animate-none",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-extrabold sm:text-sm">
                        Selecciona una hora disponible
                      </div>

                      <div className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                        <Sparkles className="h-4 w-4" />
                        <span>Elige la que más te acomode</span>
                      </div>
                    </div>

                    {activeSlots.length === 0 ? (
                      <div className="mt-3 rounded-2xl border bg-white p-3 text-[11px] text-muted-foreground sm:text-sm">
                        No hay horarios disponibles para este día.
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 sm:gap-4">
                        {(["Mañana", "Tarde", "Noche"] as const).map((label) => {
                          const list = buckets[label] ?? [];
                          if (list.length === 0) return null;

                          const count = bucketCounts[label] ?? 0;

                          return (
                            <div
                              key={label}
                              className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-3 sm:p-4"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white ring-1 ring-border shadow-sm">
                                    <span className="text-muted-foreground">
                                      <BucketIcon label={label} />
                                    </span>
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-extrabold sm:text-sm">
                                      {label}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground sm:text-xs">
                                      {count === 1 ? "1 horario" : `${count} horarios`}
                                    </div>
                                  </div>
                                </div>

                                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-extrabold text-slate-500 sm:text-xs">
                                  {count >= 99 ? "99+" : count}
                                </span>
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                {list.map((s: Slot) => {
                                  const active =
                                    selectedSlot?.start_at === s.start_at;

                                  return (
                                    <button
                                      key={s.start_at}
                                      type="button"
                                      disabled={saving || !tenantId}
                                      onClick={() => {
                                        setSelectedSlot(s);
                                        setTimeout(() => scrollToRef(contactRef), 90);
                                      }}
                                      className={cn(
                                        "relative w-full rounded-2xl border text-left transition",
                                        "min-h-[52px] px-3 py-3",
                                        "active:scale-[0.98] motion-reduce:active:scale-100",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        "shadow-sm",
                                        active
                                          ? "border-slate-900 bg-slate-900 text-white ring-2 ring-slate-900/20"
                                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                                        saving || !tenantId
                                          ? "cursor-not-allowed opacity-60"
                                          : "",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full",
                                          active ? "bg-white/15" : "bg-slate-100",
                                        )}
                                      >
                                        {active ? (
                                          <Check className="h-3.5 w-3.5" />
                                        ) : (
                                          <span className="h-2 w-2 rounded-full bg-slate-400/50" />
                                        )}
                                      </span>

                                      <div className="text-[14px] font-extrabold leading-none sm:text-sm">
                                        {onlyTimeCL(s.start_at)}
                                      </div>
                                      <div
                                        className={cn(
                                          "mt-1 text-[10px] leading-none",
                                          active
                                            ? "text-white/80"
                                            : "text-muted-foreground",
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
                    )}

                    <div className="mt-4 rounded-3xl border bg-white p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-border">
                          <Check className="h-4 w-4 text-muted-foreground" />
                        </span>

                        <div className="min-w-0">
                          <div className="text-[11px] text-muted-foreground sm:text-sm">
                            <span className="font-semibold text-foreground">
                              Elegido:
                            </span>{" "}
                            {selectedSlot ? formatCL(selectedSlot.start_at) : "—"}
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
                            Las horas pueden agotarse. Confirma cuando estés listo.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <div ref={contactRef} />
            <section
              className={cn(
                "mt-3 rounded-[28px] border border-border/80 bg-white/90 p-3 shadow-sm backdrop-blur sm:p-5",
                lockContact ? "opacity-70" : "",
              )}
            >
              <SectionHeader
                icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                title="Datos de contacto"
                subtitle="Te enviaremos la confirmación al correo."
              />

              <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-[10.5px] text-muted-foreground sm:text-xs">
                Tus datos se usan solo para gestionar tu reserva y enviarte la confirmación.
              </div>

              <div className="mt-3 grid gap-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold sm:text-sm">
                    Nombre
                  </label>
                  <input
                    value={fullName}
                    disabled={saving || !tenantId}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      if (!nameTouched) setNameTouched(true);
                    }}
                    placeholder="Ej: Juan Pérez"
                    className="h-11 w-full rounded-2xl border bg-white px-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
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
                        if (isValidCLMobile(phone))
                          setPhone(normalizeToE164CLMobile(phone));
                      }}
                      placeholder="Ej: 912345678 o +56912345678"
                      className={cn(
                        "h-11 w-full rounded-2xl border bg-white pl-10 pr-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm",
                        phoneTouched && phone.trim().length > 0 && !isPhoneValid
                          ? "border-red-300 focus:ring-red-200"
                          : "focus:ring-foreground/20",
                      )}
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
                  <label className="mb-1.5 block text-[11px] font-semibold sm:text-sm">
                    Correo
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={email}
                      disabled={saving || !tenantId}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (!emailTouched) setEmailTouched(true);
                      }}
                      onBlur={() => setEmail((v) => v.trim().toLowerCase())}
                      placeholder="Ej: nombre@gmail.com"
                      className={cn(
                        "h-11 w-full rounded-2xl border bg-white pl-10 pr-3 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm",
                        email.trim().length > 0 && !isValidEmail(email)
                          ? "border-red-300 focus:ring-red-200"
                          : "focus:ring-foreground/20",
                      )}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border bg-white px-3 py-2 text-center text-[10px] text-muted-foreground sm:text-xs">
                  Al reservar aceptas recibir mensajes relacionados a tu cita.
                </div>
              </div>
            </section>
          </div>

          <aside className="hidden lg:block">
            <section className="rounded-[28px] border border-border/80 bg-white/90 p-4 shadow-sm backdrop-blur lg:sticky lg:top-6">
              <div className="mb-2 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <div className="text-base font-extrabold">
                  Resumen de tu reserva
                </div>
              </div>

              <div className="mt-3 rounded-3xl border bg-gradient-to-br from-white to-slate-50 p-4">
                <div className="text-sm font-extrabold">
                  {service?.name ??
                    (serviceId ? "Servicio seleccionado" : "Servicio")}
                </div>

                <div className="mt-3 text-sm text-muted-foreground">
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
                <div className="mt-1 text-sm font-extrabold">
                  {selectedSlot ? formatCL(selectedSlot.start_at) : "—"}
                </div>
              </div>

              <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                Confirmación inmediata por correo y enlace privado para gestionar tu cita.
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleReserve}
                  disabled={!canSubmit}
                  className={cn(
                    "h-12 w-full rounded-2xl text-sm font-extrabold transition shadow-sm",
                    canSubmit
                      ? "bg-slate-900 text-white hover:opacity-95"
                      : "cursor-not-allowed bg-muted text-muted-foreground",
                  )}
                >
                  {saving ? "Reservando..." : "Confirmar reserva"}
                </button>
              </div>
            </section>
          </aside>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-2 backdrop-blur lg:hidden">
          <div className="mx-auto max-w-[460px] px-1">
            <div className="mb-2 rounded-3xl border bg-white px-3 py-2.5 text-[10.5px] text-muted-foreground shadow-sm">
              <div className="truncate">
                <span className="font-extrabold text-foreground">
                  {mobileSummary.svc}
                </span>
                {mobileSummary.price ? <span> · {mobileSummary.price}</span> : null}
              </div>
              <div className="truncate">🕒 {mobileSummary.time}</div>
            </div>

            <button
              type="button"
              onClick={handleReserve}
              disabled={!canSubmit}
              className={cn(
                "h-12 w-full rounded-3xl text-[12px] font-extrabold transition shadow-sm",
                canSubmit
                  ? "bg-slate-900 text-white hover:opacity-95"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              {saving ? "Reservando..." : "Confirmar reserva"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ReservarPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-[460px] px-3 py-10 font-[system-ui] text-[12px] sm:max-w-3xl sm:px-4 sm:text-[14px] lg:max-w-6xl lg:px-6">
          Cargando…
        </main>
      }
    >
      <ReservarInner />
    </Suspense>
  );
}