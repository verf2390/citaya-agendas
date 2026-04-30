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
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { SurfaceCard } from "@/components/ui/card";
import { DemoContainer, DemoShell } from "@/components/layouts/demo-shell";

type Slot = { start_at: string; end_at: string };
type WaitlistTarget =
  | { type: "exact"; slot: Slot }
  | { type: "flexible"; dayKey: string };

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

type TenantPaymentMode = "none" | "optional" | "required";
type PaymentChoice = "pay_now" | "pay_later";
type PaymentProviderId = "mercadopago" | "webpay" | "khipu" | "manual";
type PaymentCollectionMode = "none" | "full" | "deposit";
type TenantDepositType = "fixed" | "percentage" | null;

const tz = "America/Santiago";
const PAGE_SIZE = 7;
const MAX_DAYS_AHEAD = 60;

const DEFAULT_MIN_LEAD_TIME_MIN = 120; // 2 horas
const ENABLE_WAITLIST: boolean = true;
const PAYMENT_PROVIDER_LABELS: Record<PaymentProviderId, string> = {
  mercadopago: "Mercado Pago",
  webpay: "Webpay Plus",
  khipu: "Khipu",
  manual: "Transferencia/manual",
};

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

function waitlistTimeCL(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hh = parts.find((p) => p.type === "hour")?.value ?? "";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "";
  return `${hh}:${mm}`;
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
    <div className="rounded-3xl border border-white/70 bg-white/88 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-sm">
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
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#ffffff_0%,#eef2f7_100%)] ring-1 ring-slate-200/80 shadow-[0_10px_22px_rgba(15,23,42,0.08)]">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-black tracking-[-0.01em] sm:text-base">
              {title}
            </div>
            {subtitle ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground/90 sm:mt-1 sm:text-sm">
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
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold backdrop-blur-sm sm:text-xs",
        done
          ? "border-emerald-200/70 bg-emerald-50/90 text-emerald-700 shadow-[0_8px_18px_rgba(16,185,129,0.08)]"
          : active
            ? "border-slate-900/10 bg-slate-900 text-white shadow-[0_10px_22px_rgba(15,23,42,0.14)]"
            : "border-white/80 bg-white/78 text-slate-500 shadow-[0_8px_18px_rgba(15,23,42,0.05)]",
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
          done
            ? "bg-emerald-100 text-emerald-700"
            : active
              ? "bg-white/15 text-white"
              : "bg-slate-100/90 text-slate-500",
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
  const paymentRef = useRef<HTMLDivElement>(null);

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
  const [tenantPaymentMode, setTenantPaymentMode] =
    useState<TenantPaymentMode>("none");

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
  const [unavailableSlots, setUnavailableSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [selectedDayKey, setSelectedDayKey] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("pay_later");
  const [paymentMethodsEnabled, setPaymentMethodsEnabled] = useState<
    PaymentProviderId[]
  >(["mercadopago"]);
  const [selectedPaymentProvider, setSelectedPaymentProvider] =
    useState<PaymentProviderId>("mercadopago");
  const [tenantPaymentCollectionMode, setTenantPaymentCollectionMode] =
    useState<PaymentCollectionMode>("full");
  const [tenantDepositType, setTenantDepositType] =
    useState<TenantDepositType>(null);
  const [tenantDepositValue, setTenantDepositValue] = useState<number | null>(
    null,
  );

  const [saving, setSaving] = useState(false);
  const [waitlistSavingSlot, setWaitlistSavingSlot] = useState<string | null>(null);
  const [waitlistTarget, setWaitlistTarget] = useState<WaitlistTarget | null>(
    null,
  );
  const [waitlistName, setWaitlistName] = useState("");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistPhone, setWaitlistPhone] = useState("");
  const [waitlistNote, setWaitlistNote] = useState("");
  const [waitlistFeedback, setWaitlistFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const phoneNorm = useMemo(() => normalizeCLPhone(phone), [phone]);
  const isPhoneValid = useMemo(() => isValidCLMobile(phone), [phone]);

  useEffect(() => {
    if (!tenantSlug) {
      setTenantId("");
      setTenantName("");
      setMinLeadTimeMin(DEFAULT_MIN_LEAD_TIME_MIN);
      setTenantPaymentMode("none");
      setPaymentMethodsEnabled(["mercadopago"]);
      setSelectedPaymentProvider("mercadopago");
      setTenantPaymentCollectionMode("full");
      setTenantDepositType(null);
      setTenantDepositValue(null);
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
          setTenantPaymentMode(
            (json?.tenant?.payment_mode as TenantPaymentMode | undefined) ??
              "none",
          );
          const methods = Array.isArray(json?.tenant?.payment_methods_enabled)
            ? json.tenant.payment_methods_enabled.filter(
                (method: unknown): method is PaymentProviderId =>
                  method === "mercadopago" ||
                  method === "webpay" ||
                  method === "khipu" ||
                  method === "manual",
              )
            : [];
          const nextMethods = methods.length > 0 ? methods : ["mercadopago"];

          setPaymentMethodsEnabled(nextMethods);
          setSelectedPaymentProvider((prev) =>
            nextMethods.includes(prev) ? prev : nextMethods[0],
          );
          setTenantPaymentCollectionMode(
            (json?.tenant?.payment_collection_mode as
              | PaymentCollectionMode
              | undefined) ?? "full",
          );
          setTenantDepositType(
            (json?.tenant?.deposit_type as TenantDepositType | undefined) ??
              null,
          );
          setTenantDepositValue(
            typeof json?.tenant?.deposit_value === "number"
              ? json.tenant.deposit_value
              : null,
          );

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
          setTenantPaymentMode("none");
          setPaymentMethodsEnabled(["mercadopago"]);
          setSelectedPaymentProvider("mercadopago");
          setTenantPaymentCollectionMode("full");
          setTenantDepositType(null);
          setTenantDepositValue(null);
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

  useEffect(() => {
    if (tenantPaymentMode === "required") {
      setPaymentChoice("pay_now");
      return;
    }

    if (tenantPaymentMode === "none") {
      setPaymentChoice("pay_later");
    }
  }, [tenantPaymentMode]);

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
      setUnavailableSlots([]);
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
      const unavailable = Array.isArray(json?.unavailable_slots)
        ? (json.unavailable_slots as Slot[])
        : [];
      setSlots(list);
      setUnavailableSlots(unavailable);

      const pageDays = buildPageDays(pageStart);
      setSelectedDayKey(pageDays[0]?.dayKey ?? "");
    } catch (e: any) {
      console.error(e);
      setSlots([]);
      setUnavailableSlots([]);
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

  const activeUnavailableSlots: Slot[] = useMemo(() => {
    if (!selectedDayKey) return [];
    const minTs = Date.now() + (minLeadTimeMin || 0) * 60_000;
    return unavailableSlots
      .filter((slot) => dayKeyCL(slot.start_at) === selectedDayKey)
      .filter((slot) => new Date(slot.start_at).getTime() >= minTs)
      .sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
  }, [unavailableSlots, selectedDayKey, minLeadTimeMin]);

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
    (tenantPaymentMode !== "required" || paymentChoice === "pay_now") &&
    !saving;

  const showPaymentOptions = tenantPaymentMode !== "none";
  const isPaymentRequired = tenantPaymentMode === "required";
  const isPayNowSelected = showPaymentOptions && paymentChoice === "pay_now";
  const currentPaymentStatus = showPaymentOptions
    ? isPayNowSelected
      ? "pending"
      : "not_required"
    : "not_required";

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

    if (isPaymentRequired && paymentChoice !== "pay_now") {
      alert("Este servicio requiere pago online para reservar.");
      scrollToRef(paymentRef);
      return;
    }

    setSaving(true);

    let createdAppointmentId: string | null = null;
    let createdManageToken: string | null = null;

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
        paymentRequired: isPayNowSelected,
        paymentStatus: currentPaymentStatus,

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
      createdAppointmentId = appointmentId ?? null;
      createdManageToken = manageToken ?? null;

      if (!appointmentId)
        throw new Error("Reserva creada pero falta id en respuesta.");

      if (isPayNowSelected) {
        const paymentRes = await fetch("/api/payments/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appointmentId,
            tenantId,
            provider: selectedPaymentProvider,
          }),
        });

        const paymentJson = await paymentRes.json().catch(() => null);
        const paymentUrl = paymentJson?.payment_url ?? paymentJson?.init_point;

        if (!paymentRes.ok || !paymentUrl) {
          throw new Error(
            paymentJson?.error ??
              "La reserva fue creada, pero no se pudo iniciar el pago online.",
          );
        }

        if (
          paymentJson?.redirect_method === "POST" &&
          paymentJson?.redirect_payload &&
          typeof paymentJson.redirect_payload === "object"
        ) {
          const form = document.createElement("form");
          form.method = "POST";
          form.action = String(paymentUrl);

          for (const [key, value] of Object.entries(
            paymentJson.redirect_payload as Record<string, unknown>,
          )) {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = key;
            input.value = String(value);
            form.appendChild(input);
          }

          document.body.appendChild(form);
          form.submit();
          return;
        }

        window.location.assign(String(paymentUrl));
        return;
      }

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
      if (createdAppointmentId) {
        if (createdManageToken) {
          try {
            sessionStorage.setItem(
              `citaya_manage_token:${createdAppointmentId}`,
              createdManageToken,
            );
          } catch {}
        }

        alert(
          e?.message ??
            "La reserva fue creada, pero hubo un problema iniciando el pago.",
        );
        router.push(`/reservar/confirmacion?id=${createdAppointmentId}`);
        return;
      }

      alert(e?.message ?? "Error reservando");
    } finally {
      setSaving(false);
    }
  };

  const openWaitlist = (target: WaitlistTarget) => {
    setWaitlistTarget(target);
    setWaitlistName((prev) => prev || fullName);
    setWaitlistEmail((prev) => prev || email);
    setWaitlistPhone((prev) => prev || phone);
    setWaitlistFeedback(null);
  };

  const closeWaitlist = () => {
    setWaitlistTarget(null);
    setWaitlistFeedback(null);
  };

  const getWaitlistSlotPayload = (target: WaitlistTarget) => {
    if (target.type === "exact") {
      return {
        date: dayKeyCL(target.slot.start_at),
        time: waitlistTimeCL(target.slot.start_at),
        desiredFromAt: target.slot.start_at,
        desiredToAt: target.slot.end_at,
        savingKey: target.slot.start_at,
        label: formatCL(target.slot.start_at),
      };
    }

    const from = new Date(`${target.dayKey}T00:00:00`);
    const to = new Date(`${target.dayKey}T23:59:59`);
    return {
      date: target.dayKey,
      time: "00:00",
      desiredFromAt: Number.isNaN(from.getTime()) ? null : from.toISOString(),
      desiredToAt: Number.isNaN(to.getTime()) ? null : to.toISOString(),
      savingKey: `flexible:${target.dayKey}`,
      label: dayLabelCL(target.dayKey),
    };
  };

  const submitWaitlist = async () => {
    if (!ENABLE_WAITLIST || !waitlistTarget) return;

    if (!tenantId || !serviceId) {
      setWaitlistFeedback({
        tone: "error",
        text: "Selecciona un servicio antes de unirte a la lista de espera.",
      });
      return;
    }

    const name = waitlistName.trim();
    const contactEmail = waitlistEmail.trim().toLowerCase();
    const contactPhone = waitlistPhone.trim();

    if (!name) {
      setWaitlistFeedback({
        tone: "error",
        text: "Ingresa tu nombre para avisarte correctamente.",
      });
      return;
    }
    if (!contactEmail || !isValidEmail(contactEmail)) {
      setWaitlistFeedback({
        tone: "error",
        text: "Ingresa un email válido.",
      });
      return;
    }

    const slotPayload = getWaitlistSlotPayload(waitlistTarget);

    setWaitlistSavingSlot(slotPayload.savingKey);
    setWaitlistFeedback(null);
    try {
      const res = await fetch("/api/waitlist/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId,
          tenantSlug,
          serviceId,
          professionalId: professionalId || undefined,
          date: slotPayload.date,
          time: slotPayload.time,
          desiredFromAt: slotPayload.desiredFromAt,
          desiredToAt: slotPayload.desiredToAt,
          customerName: name,
          customerEmail: contactEmail,
          customerPhone: contactPhone,
          notes:
            waitlistNote.trim() ||
            (waitlistTarget.type === "flexible"
              ? "Cliente acepta cualquier cupo disponible para el día seleccionado."
              : null),
          source:
            waitlistTarget.type === "exact"
              ? "booking_flow_exact_slot"
              : "booking_flow_no_slots",
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "No se pudo registrar la lista de espera");
      }

      setWaitlistFeedback({
        tone: "success",
        text: json.duplicate
          ? "Ya estabas en la lista de espera para esa solicitud."
          : "Te agregamos a la lista de espera. Te avisaremos si se libera un cupo.",
      });
    } catch (e: any) {
      setWaitlistFeedback({
        tone: "error",
        text: e?.message ?? "No se pudo registrar la lista de espera",
      });
    } finally {
      setWaitlistSavingSlot(null);
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
    const payment =
      tenantPaymentMode === "none"
        ? "Sin pago online"
        : paymentChoice === "pay_now"
          ? "Pagar ahora"
          : "Pagar después";
    return { svc, time, price, payment };
  }, [service, serviceId, selectedSlot, tenantPaymentMode, paymentChoice]);

  const paymentBreakdown = useMemo(() => {
    const total =
      typeof service?.price === "number" && Number.isFinite(service.price)
        ? Math.max(Math.round(service.price), 0)
        : 0;

    if (tenantPaymentCollectionMode === "none" || total <= 0) {
      return { total, requiredNow: 0, remaining: total };
    }

    if (tenantPaymentCollectionMode === "deposit") {
      const value = Number(tenantDepositValue ?? 0);
      const requiredNow =
        tenantDepositType === "percentage"
          ? Math.round(total * (value / 100))
          : tenantDepositType === "fixed"
            ? Math.round(value)
            : total;
      const boundedRequiredNow = Math.min(Math.max(requiredNow, 0), total);

      return {
        total,
        requiredNow: boundedRequiredNow,
        remaining: Math.max(total - boundedRequiredNow, 0),
      };
    }

    return { total, requiredNow: total, remaining: 0 };
  }, [
    service?.price,
    tenantDepositType,
    tenantDepositValue,
    tenantPaymentCollectionMode,
  ]);

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
    <DemoShell className="overflow-x-clip">
      <DemoContainer
        size="booking"
        className="font-[system-ui] text-[12px] leading-snug sm:text-[14px] sm:leading-normal"
      >
        <div
          className={cn(
            "sticky top-0 z-40 -mx-2 px-2 pb-3 pt-3 sm:-mx-4 sm:px-4 lg:static lg:mx-0 lg:px-0 lg:pt-0",
            isScrolled ? "bg-background/72 backdrop-blur-2xl" : "bg-transparent",
          )}
        >
          <SurfaceCard
            tone="glass"
            shadow="panel"
            radius="xl"
            className="relative overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.9))] px-4 py-4 ring-white/60 shadow-[0_24px_60px_rgba(15,23,42,0.12)] sm:px-5 sm:py-5"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(15,23,42,0.06),transparent)]" />

            <div className="relative flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#ffffff_0%,#e2e8f0_100%)] ring-1 ring-slate-200 shadow-[0_10px_24px_rgba(15,23,42,0.10)] sm:h-11 sm:w-11">
                  <span className="text-[10px] font-extrabold sm:text-sm">
                    {(tenantName || tenantSlug || "C").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="max-w-full break-words text-[13px] font-black leading-tight tracking-[-0.02em] sm:text-[18px] sm:leading-tight">
                    {tenantName || tenantSlug || "Reserva tu hora"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground sm:text-sm">
                    Reserva en pocos pasos • confirmación automática
                  </div>
                </div>
              </div>

              <Button
                type="button"
                onClick={onClose}
                variant="pill"
                size="icon"
                className="h-9 w-9 rounded-2xl sm:h-10 sm:w-10"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>

            <div className="relative mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2.5">
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
                <div className="rounded-2xl border border-white/80 bg-white/72 px-3.5 py-2.5 text-[10.5px] text-muted-foreground shadow-[0_10px_24px_rgba(15,23,42,0.05)] backdrop-blur-sm sm:text-xs lg:max-w-[320px]">
                  Elige un servicio, selecciona la hora y confirma tus datos.
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-200/80 bg-[linear-gradient(180deg,#ecfdf5_0%,#d1fae5_100%)] px-3.5 py-2.5 text-[10.5px] text-emerald-800 shadow-[0_10px_24px_rgba(16,185,129,0.10)] sm:text-xs lg:max-w-[320px]">
                  Hora elegida:{" "}
                  <span className="font-extrabold">
                    {formatCL(selectedSlot.start_at)}
                  </span>
                </div>
              )}
            </div>

            {serviceAlert ? (
              <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/92 p-2.5 text-[11px] text-amber-800 shadow-[0_8px_18px_rgba(245,158,11,0.08)] sm:text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <div>
                    <b>Atención:</b> {serviceAlert}
                  </div>
                </div>
              </div>
            ) : null}
          </SurfaceCard>
        </div>

        <div className="grid gap-4 pt-4 sm:gap-5 lg:grid-cols-[minmax(0,1.08fr)_320px]">
          <div className="lg:col-span-2">
            <div ref={serviceRef} />
            <Section className="bg-white/84 p-4 ring-white/70 shadow-[0_22px_56px_rgba(15,23,42,0.09)] sm:p-6">
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
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {services.length === 0 ? (
                    <SurfaceCard
                      tone="default"
                      shadow="soft"
                      radius="lg"
                      className="p-3 text-[11px] text-muted-foreground sm:text-sm"
                    >
                      No hay servicios activos configurados.
                    </SurfaceCard>
                  ) : (
                    services.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => pickService(s.id)}
                        className={cn(
                          "w-full rounded-[26px] border border-slate-200/70 bg-white/88 p-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition duration-200",
                          "hover:-translate-y-px hover:border-slate-300/80 hover:shadow-[0_16px_28px_rgba(15,23,42,0.10)] active:translate-y-0 active:scale-[0.99]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#ffffff_0%,#e2e8f0_100%)] ring-1 ring-slate-200 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
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

                          <span className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-[10px] font-extrabold text-white shadow-[0_8px_18px_rgba(15,23,42,0.12)] sm:text-xs">
                            Elegir
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <SurfaceCard
                  tone="default"
                  shadow="soft"
                  radius="lg"
                  className="mt-4 bg-white/88 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#020617_0%,#0f172a_45%,#1e293b_100%)] text-white shadow-[0_12px_26px_rgba(15,23,42,0.20)]">
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
                      <Button
                        type="button"
                        onClick={() => {
                          const p = new URLSearchParams(searchParams.toString());
                          p.delete("service");
                          router.push(`/reservar?${p.toString()}`);
                          setTimeout(() => scrollToRef(serviceRef), 60);
                        }}
                        variant="pill"
                        className="h-10 gap-2 border-white/80 bg-white/78 px-4 text-[12px] font-extrabold shadow-[0_8px_18px_rgba(15,23,42,0.06)] hover:bg-white"
                        title="Cambiar servicio"
                      >
                        <X className="h-4 w-4 shrink-0" />
                        <span className="whitespace-nowrap">Cambiar servicio</span>
                      </Button>
                    </div>
                  </div>
                </SurfaceCard>
              )}
            </Section>

            <Section className="mt-4 bg-white/84 p-4 ring-white/70 shadow-[0_22px_56px_rgba(15,23,42,0.09)] sm:p-6">
              <SectionHeader
                icon={<User className="h-4 w-4 text-muted-foreground" />}
                title="Profesional"
                subtitle="Selecciona quién te atenderá."
              />

              {loadingPros ? (
                <SurfaceCard
                  tone="default"
                  shadow="soft"
                  radius="lg"
                  className="mt-3 p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-2xl bg-muted/60 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <SkeletonLine w="w-1/2" />
                      <SkeletonLine w="w-2/3" />
                    </div>
                  </div>
                </SurfaceCard>
              ) : professionals.length === 0 ? (
                <SurfaceCard
                  tone="default"
                  shadow="soft"
                  radius="lg"
                  className="mt-3 p-3 text-[12px] font-extrabold sm:text-sm"
                >
                  Sin profesionales configurados
                  <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
                    Agrega profesionales en Supabase → <b>professionals</b> (active=true).
                  </div>
                </SurfaceCard>
              ) : (
                <>
                  {professionals.length > 1 ? (
                    <select
                      value={professionalId}
                      disabled={saving || !tenantId}
                      onChange={(e) => setProfessionalId(e.target.value)}
                      className="mt-4 h-11 w-full rounded-2xl border border-white/80 bg-white/88 px-3 text-[12px] font-medium shadow-[0_8px_18px_rgba(15,23,42,0.05)] outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
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
                      <SurfaceCard
                        tone="default"
                        shadow="soft"
                        radius="lg"
                        className="mt-4 bg-white/88 p-3 sm:p-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(180deg,#ffffff_0%,#e2e8f0_100%)] ring-1 ring-slate-200 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
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
                      </SurfaceCard>
                    );
                  })()}
                </>
              )}
            </Section>

            <div ref={slotRef} />
            <Section
              className={cn(
                "mt-4 border-white/70 bg-white/84 p-4 ring-white/70 shadow-[0_22px_56px_rgba(15,23,42,0.09)] sm:p-6",
                lockSlots ? "opacity-70" : "",
              )}
            >
              <SectionHeader
                icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
                title="Selecciona fecha y hora"
                subtitle={`Solo horarios disponibles • Duración: ${durationMin} min`}
                right={
                  <Button
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
                    variant="pill"
                    className="h-9 border-white/80 bg-white/78 px-3 text-[11px] font-semibold shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:bg-white sm:h-10 sm:text-sm"
                  >
                    {loadingSlots ? "Cargando..." : "Recargar"}
                  </Button>
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
                <SurfaceCard
                  tone="default"
                  shadow="soft"
                  radius="lg"
                  className="mt-3 p-3 text-[11px] text-muted-foreground sm:text-sm"
                >
                  Selecciona un <b>servicio</b> para ver horarios.
                </SurfaceCard>
              ) : (
                <div className="mt-3">
                  <div className="relative">
                    <div className="flex items-center gap-2 min-w-0">
                      <Button
                        type="button"
                        onClick={goPrev7}
                        disabled={!canPrev}
                        variant="pill"
                        size="icon"
                        className="h-10 w-10 rounded-2xl border-white/80 bg-white/78 shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:bg-white"
                        title="Anterior"
                        aria-label="Anterior"
                      >
                        <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                      </Button>

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
                                    "shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-[10px] font-semibold ring-1 ring-slate-200/80 transition",
                                    "sm:px-4 sm:py-2 sm:text-sm",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    active
                                      ? "bg-slate-900 text-white shadow-[0_10px_22px_rgba(15,23,42,0.14)]"
                                      : "bg-white/82 hover:bg-white",
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

                      <Button
                        type="button"
                        onClick={goNext7}
                        disabled={!canNext}
                        variant="pill"
                        size="icon"
                        className="h-10 w-10 rounded-2xl border-white/80 bg-white/78 shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:bg-white"
                        title="Siguiente"
                        aria-label="Siguiente"
                      >
                        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
                      </Button>
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
                      <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/75 p-3 sm:p-4">
                        <div className="text-[12px] font-extrabold text-amber-950 sm:text-sm">
                          No hay horarios disponibles para este día.
                        </div>
                        {ENABLE_WAITLIST ? (
                          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-[11px] leading-relaxed text-amber-800 sm:text-sm">
                              ¿No encontraste una hora disponible? Déjanos tus datos y te avisaremos cuando se libere un cupo.
                            </p>
                            <Button
                              type="button"
                              onClick={() =>
                                selectedDayKey &&
                                openWaitlist({
                                  type: "flexible",
                                  dayKey: selectedDayKey,
                                })
                              }
                              disabled={!selectedDayKey || waitlistSavingSlot !== null}
                              variant="pill"
                              className="h-10 shrink-0 bg-slate-900 px-4 text-[11px] font-extrabold text-white hover:bg-slate-800 sm:text-sm"
                            >
                              Unirme a lista de espera
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 sm:gap-4">
                        {(["Mañana", "Tarde", "Noche"] as const).map((label) => {
                          const list = buckets[label] ?? [];
                          if (list.length === 0) return null;

                          const count = bucketCounts[label] ?? 0;

                          return (
                            <SurfaceCard
                              key={label}
                              tone="default"
                              shadow="soft"
                              radius="lg"
                              className="border-slate-200/60 bg-gradient-to-br from-white/96 to-slate-50/96 p-3 sm:p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]"
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
                                        "shadow-[0_8px_18px_rgba(15,23,42,0.05)]",
                                        active
                                          ? "border-slate-900/10 bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_100%)] text-white ring-2 ring-slate-900/15"
                                          : "border-slate-200/70 bg-white/88 hover:border-slate-300/80 hover:bg-white",
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
                            </SurfaceCard>
                          );
                        })}
                      </div>
                    )}

                    {ENABLE_WAITLIST && activeUnavailableSlots.length > 0 ? (
                      <div className="mt-3 rounded-2xl border border-amber-200/70 bg-amber-50/70 p-3">
                        <div className="text-[11px] font-extrabold text-amber-900 sm:text-sm">
                          Horarios ocupados
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          {activeUnavailableSlots.map((s) => (
                            <button
                              key={s.start_at}
                              type="button"
                              disabled={waitlistSavingSlot === s.start_at}
                              onClick={() => openWaitlist({ type: "exact", slot: s })}
                              className="min-h-[52px] rounded-2xl border border-amber-200 bg-white/85 px-3 py-2 text-left text-amber-950 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
                            >
                              <div className="text-[14px] font-extrabold leading-none sm:text-sm">
                                {onlyTimeCL(s.start_at)}
                              </div>
                              <div className="mt-1 text-[10px] leading-none text-amber-700">
                                Unirme a lista de espera
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {ENABLE_WAITLIST && waitlistTarget ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_12px_28px_rgba(15,23,42,0.06)] sm:p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[12px] font-black text-slate-950 sm:text-base">
                              Lista de espera
                            </div>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-500 sm:text-sm">
                              {waitlistTarget.type === "exact"
                                ? `Te avisaremos si se libera ${getWaitlistSlotPayload(waitlistTarget).label}.`
                                : `Te avisaremos si aparece un cupo para ${getWaitlistSlotPayload(waitlistTarget).label}.`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={closeWaitlist}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                            aria-label="Cerrar lista de espera"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <label className="grid gap-1 text-[11px] font-bold text-slate-700 sm:text-sm">
                            Nombre
                            <input
                              value={waitlistName}
                              onChange={(e) => setWaitlistName(e.target.value)}
                              className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-slate-400"
                              placeholder="Tu nombre"
                            />
                          </label>
                          <label className="grid gap-1 text-[11px] font-bold text-slate-700 sm:text-sm">
                            Email
                            <input
                              value={waitlistEmail}
                              onChange={(e) => setWaitlistEmail(e.target.value)}
                              className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-slate-400"
                              placeholder="correo@dominio.cl"
                              inputMode="email"
                              autoComplete="email"
                            />
                          </label>
                          <label className="grid gap-1 text-[11px] font-bold text-slate-700 sm:text-sm">
                            Teléfono opcional
                            <input
                              value={waitlistPhone}
                              onChange={(e) => setWaitlistPhone(e.target.value)}
                              className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-slate-400"
                              placeholder="+56 9..."
                              inputMode="tel"
                              autoComplete="tel"
                            />
                          </label>
                        </div>

                        <label className="mt-3 grid gap-1 text-[11px] font-bold text-slate-700 sm:text-sm">
                          Comentario opcional
                          <input
                            value={waitlistNote}
                            onChange={(e) => setWaitlistNote(e.target.value)}
                            className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-slate-400"
                            placeholder="Ej: prefiero la mañana, puedo moverme de día"
                          />
                        </label>

                        {waitlistFeedback ? (
                          <div
                            className={cn(
                              "mt-3 rounded-xl border p-3 text-[11px] font-semibold sm:text-sm",
                              waitlistFeedback.tone === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-red-200 bg-red-50 text-red-700",
                            )}
                          >
                            {waitlistFeedback.text}
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                          <Button
                            type="button"
                            onClick={closeWaitlist}
                            variant="pill"
                            className="h-10 border-slate-200 bg-white px-4 text-[11px] font-bold text-slate-700 hover:bg-slate-50 sm:text-sm"
                          >
                            Cancelar
                          </Button>
                          <Button
                            type="button"
                            onClick={submitWaitlist}
                            disabled={waitlistSavingSlot !== null}
                            variant="pill"
                            className="h-10 bg-slate-900 px-4 text-[11px] font-extrabold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60 sm:text-sm"
                          >
                            {waitlistSavingSlot ? "Guardando..." : "Guardar solicitud"}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <SurfaceCard
                      tone="default"
                      shadow="soft"
                      radius="lg"
                      className="mt-4 border-white/80 bg-white/80 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
                    >
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
                    </SurfaceCard>
                  </div>
                </div>
              )}
            </Section>

            <div ref={contactRef} />
            <Section
              className={cn(
                "mt-4 bg-white/84 p-4 ring-white/70 shadow-[0_22px_56px_rgba(15,23,42,0.09)] sm:p-6",
                lockContact ? "opacity-70" : "",
              )}
            >
              <SectionHeader
                icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                title="Datos de contacto"
                subtitle="Te enviaremos la confirmación al correo."
              />

              <div className="mt-4 rounded-2xl border border-white/80 bg-white/74 px-3.5 py-2.5 text-[10.5px] text-muted-foreground shadow-[0_8px_18px_rgba(15,23,42,0.05)] backdrop-blur-sm sm:text-xs">
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
                    className="h-11 w-full rounded-2xl border border-white/80 bg-white/90 px-3 text-[12px] shadow-[0_8px_18px_rgba(15,23,42,0.05)] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
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
                        "h-11 w-full rounded-2xl border bg-white/90 pl-10 pr-3 text-[12px] shadow-[0_8px_18px_rgba(15,23,42,0.05)] outline-none placeholder:text-muted-foreground focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm",
                        phoneTouched && phone.trim().length > 0 && !isPhoneValid
                          ? "border-red-300 focus:ring-red-200"
                          : "border-slate-200 focus:ring-foreground/20",
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
                        "h-11 w-full rounded-2xl border bg-white/90 pl-10 pr-3 text-[12px] shadow-[0_8px_18px_rgba(15,23,42,0.05)] outline-none placeholder:text-muted-foreground focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm",
                        email.trim().length > 0 && !isValidEmail(email)
                          ? "border-red-300 focus:ring-red-200"
                          : "border-slate-200 focus:ring-foreground/20",
                      )}
                    />
                  </div>
                </div>

                <SurfaceCard
                  tone="default"
                  shadow="soft"
                  radius="lg"
                  className="border-white/80 bg-white/76 px-3 py-2 text-center text-[10px] text-muted-foreground shadow-[0_8px_18px_rgba(15,23,42,0.05)] sm:text-xs"
                >
                  Al reservar aceptas recibir mensajes relacionados a tu cita.
                </SurfaceCard>
              </div>
            </Section>

            {showPaymentOptions ? (
              <>
                <div ref={paymentRef} />
                <Section className="mt-4 border-white/70 bg-white/84 p-4 ring-white/70 shadow-[0_22px_56px_rgba(15,23,42,0.09)] sm:p-6">
                  <SectionHeader
                    icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                    title="Pago de la reserva"
                    subtitle={
                      isPaymentRequired
                        ? "Este negocio requiere pago online para reservar."
                        : "Puedes decidir si prefieres pagar online ahora o pagar después."
                    }
                  />

                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentChoice("pay_now")}
                      className={cn(
                        "w-full rounded-[26px] border p-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition",
                        paymentChoice === "pay_now"
                          ? "border-slate-900 bg-slate-900 text-white shadow-[0_16px_30px_rgba(15,23,42,0.16)]"
                          : "border-slate-200/70 bg-white/88 hover:border-slate-300/80 hover:bg-white",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[12px] font-extrabold sm:text-sm">
                            Pagar ahora
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-[10.5px] sm:text-xs",
                              paymentChoice === "pay_now"
                                ? "text-white/85"
                                : "text-muted-foreground",
                            )}
                          >
                            Asegura tu hora pagando online.
                          </div>
                        </div>

                        <div
                          className={cn(
                            "rounded-full px-3 py-1 text-[10px] font-extrabold",
                            paymentChoice === "pay_now"
                              ? "bg-white/15 text-white"
                              : "bg-slate-900 text-white",
                          )}
                        >
                          {paymentBreakdown.requiredNow > 0
                            ? moneyCLP(paymentBreakdown.requiredNow, service?.currency)
                            : "Online"}
                        </div>
                      </div>
                    </button>

                    {paymentChoice === "pay_now" ? (
                      <div className="rounded-[24px] border border-slate-200/70 bg-white/78 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                        <div className="text-[11px] font-extrabold text-slate-700">
                          Método de pago
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {paymentMethodsEnabled.map((method) => (
                            <button
                              key={method}
                              type="button"
                              onClick={() => setSelectedPaymentProvider(method)}
                              className={cn(
                                "min-h-10 rounded-2xl border px-3 py-2 text-left text-[11px] font-extrabold transition",
                                selectedPaymentProvider === method
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                              )}
                            >
                              {PAYMENT_PROVIDER_LABELS[method]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => {
                        if (!isPaymentRequired) setPaymentChoice("pay_later");
                      }}
                      disabled={isPaymentRequired}
                      className={cn(
                        "w-full rounded-[26px] border p-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition",
                        paymentChoice === "pay_later"
                          ? "border-slate-900 bg-slate-900 text-white shadow-[0_16px_30px_rgba(15,23,42,0.16)]"
                          : "border-slate-200/70 bg-white/88 hover:border-slate-300/80 hover:bg-white",
                        isPaymentRequired ? "cursor-not-allowed opacity-60" : "",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[12px] font-extrabold sm:text-sm">
                            Pagar después
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-[10.5px] sm:text-xs",
                              paymentChoice === "pay_later"
                                ? "text-white/85"
                                : "text-muted-foreground",
                            )}
                          >
                            Reserva ahora y paga el día de la atención.
                          </div>
                        </div>

                        <div
                          className={cn(
                            "rounded-full px-3 py-1 text-[10px] font-extrabold",
                            paymentChoice === "pay_later"
                              ? "bg-white/15 text-white"
                              : "bg-slate-100 text-slate-700",
                          )}
                        >
                          {isPaymentRequired ? "Bloqueado" : "Flexible"}
                        </div>
                      </div>
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/80 bg-white/74 px-3.5 py-2.5 text-[10.5px] text-muted-foreground shadow-[0_8px_18px_rgba(15,23,42,0.05)] backdrop-blur-sm sm:text-xs">
                    {isPayNowSelected
                      ? paymentBreakdown.remaining > 0
                        ? `Pagas ahora ${moneyCLP(paymentBreakdown.requiredNow, service?.currency)} como abono. El saldo de ${moneyCLP(paymentBreakdown.remaining, service?.currency)} se paga en el local.`
                        : `Pagas el total ahora (${moneyCLP(paymentBreakdown.requiredNow, service?.currency)}) para confirmar tu reserva.`
                      : "La reserva se confirmará sin redirección a Mercado Pago."}
                  </div>
                </Section>
              </>
            ) : null}
          </div>

          <aside className="hidden lg:block">
            <Section className="bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.9))] p-5 ring-white/70 shadow-[0_24px_56px_rgba(15,23,42,0.10)] lg:sticky lg:top-6">
              <div className="mb-2 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <div className="text-base font-extrabold">
                  Resumen de tu reserva
                </div>
              </div>

              <SurfaceCard
                tone="default"
                shadow="soft"
                radius="lg"
                className="mt-4 border-white/80 bg-white/86 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
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

                <div className="mt-1 text-sm text-muted-foreground">
                  Pago:{" "}
                  <span className="font-extrabold text-foreground">
                    {tenantPaymentMode === "none"
                      ? "Sin pago online"
                      : paymentChoice === "pay_now"
                        ? "Pagar ahora"
                        : "Pagar después"}
                  </span>
                </div>

                <div className="mt-3 text-sm text-muted-foreground">
                  Fecha y hora:
                </div>
                <div className="mt-1 text-sm font-extrabold">
                  {selectedSlot ? formatCL(selectedSlot.start_at) : "—"}
                </div>
              </SurfaceCard>

              <div className="mt-4 rounded-2xl border border-white/80 bg-white/74 px-3.5 py-2.5 text-xs text-muted-foreground shadow-[0_8px_18px_rgba(15,23,42,0.05)] backdrop-blur-sm">
                Confirmación inmediata por correo y enlace privado para gestionar tu cita.
              </div>

              <div className="mt-4">
                <Button
                  type="button"
                  onClick={handleReserve}
                  disabled={!canSubmit}
                  variant={canSubmit ? "hero" : "secondary"}
                  className={cn(
                    "h-12 w-full rounded-2xl text-sm font-extrabold",
                    canSubmit ? "shadow-[0_16px_34px_rgba(15,23,42,0.18)] hover:shadow-[0_20px_40px_rgba(15,23,42,0.22)]" : "border border-white/80 bg-white/74 shadow-[0_8px_18px_rgba(15,23,42,0.04)]",
                    !canSubmit ? "cursor-not-allowed" : "",
                  )}
                >
                  {saving ? "Reservando..." : "Confirmar reserva"}
                </Button>
              </div>
            </Section>
          </aside>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/70 bg-background/80 p-2.5 backdrop-blur-2xl lg:hidden">
          <div className="mx-auto max-w-[460px] px-1">
              <div className="mb-2 rounded-3xl border border-white/80 bg-white/84 px-3 py-2.5 text-[10.5px] text-muted-foreground shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                <div className="truncate">
                  <span className="font-extrabold text-foreground">
                    {mobileSummary.svc}
                  </span>
                  {mobileSummary.price ? <span> · {mobileSummary.price}</span> : null}
                </div>
                <div className="truncate">🕒 {mobileSummary.time}</div>
                <div className="truncate">💳 {mobileSummary.payment}</div>
              </div>

            <Button
              type="button"
              onClick={handleReserve}
              disabled={!canSubmit}
              variant={canSubmit ? "hero" : "secondary"}
              className={cn(
                "h-12 w-full rounded-3xl text-[12px] font-extrabold",
                canSubmit ? "shadow-[0_16px_34px_rgba(15,23,42,0.18)] hover:shadow-[0_20px_40px_rgba(15,23,42,0.22)]" : "border border-white/80 bg-white/76 shadow-[0_8px_18px_rgba(15,23,42,0.04)]",
                !canSubmit ? "cursor-not-allowed" : "",
              )}
            >
              {saving ? "Reservando..." : "Confirmar reserva"}
            </Button>
          </div>
        </div>
      </DemoContainer>
    </DemoShell>
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
