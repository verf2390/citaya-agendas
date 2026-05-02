// ================================
// ✅ ADMIN AGENDA (CORREGIDO)
// - NO rompe UI ni lógica
// - Fix principal: normalizar start/end a ISO (T + offset completo) antes de FullCalendar
// - Fix display: formatDateTimeRange usa timeZone America/Santiago
// - Fix select/drop: guardamos a ISO UTC siempre (toISOString) como ya haces
// ================================

"use client";

/**
 * =====================================================
 * ADMIN AGENDA — MULTI-TENANT (subdominio)
 * =====================================================
 * - FullCalendar (citas)
 * - WeeklyAvailabilityCalendar (horarios base)
 * - ✅ Reglas de horario por SERVICIO (Opción A)
 *
 * FIX TZ / +3h:
 * - El backend/DB puede devolver timestamps tipo "2026-02-10 18:00:00+00"
 * - FullCalendar parsea mejor ISO real "2026-02-10T18:00:00+00:00" o "...Z"
 * - ✅ Normalizamos start/end antes de pasarlos a FullCalendar.
 * - ✅ Formateo de hora en modales usa timeZone explícita.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import esLocale from "@fullcalendar/core/locales/es";
import type {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  DatesSetArg,
} from "@fullcalendar/core";

import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import { toast } from "@/components/ui/use-toast";
import { normalizePhoneToWhatsApp } from "@/app/lib/phone";

import AdminAgendaHeader from "@/components/admin/AdminAgendaHeader";
import AdminNav from "@/components/admin/AdminNav";
import WeeklyAvailabilityCalendar from "@/components/admin/availability/WeeklyAvailabilityCalendar";

import AppointmentCreateModal, {
  CustomerLite,
} from "./components/AppointmentCreateModal";

/* =====================================================
   CONFIG
===================================================== */

const UI_CONFIG = {
  SLOT_MIN_TIME: "07:00:00",
  SLOT_MAX_TIME: "21:00:00",
  CALENDAR_VIEW: "timeGridWeek",
  BUSINESS_NAME: "Citaya",
  ADMIN_TIMEZONE: "America/Santiago",
};

/* =====================================================
   TYPES
===================================================== */

type AppointmentStatus = "confirmed" | "completed" | "canceled" | "no_show";

type Professional = {
  id: string;
  name: string | null;
  tenant_id?: string;
};

type Service = {
  id: string;
  tenant_id: string;
  name: string;
  duration_min: number | null;
  price: number | null;
  currency: string | null;
  is_active: boolean | null;
};

type TenantPaymentMode = "none" | "optional" | "required";
type TenantDepositType = "fixed" | "percentage" | null;
type TenantChargeType = "none" | "full" | "fixed" | "percentage";
type TenantChargeUiType = "none" | "full" | "deposit";
type TenantDepositUiType = "fixed" | "percentage";
type PaymentProviderId = "mercadopago" | "webpay" | "khipu" | "manual";

const PAYMENT_PROVIDER_LABELS: Record<PaymentProviderId, string> = {
  mercadopago: "Mercado Pago",
  webpay: "Webpay Plus",
  khipu: "Khipu",
  manual: "Transferencia/manual",
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  classNames?: string[];
  extendedProps: {
    professional_id: string;
    service_id: string | null;
    customer_phone: string | null;
    customer_name: string | null;
    status: AppointmentStatus;
    customer_id: string | null;
  };
};

type AvailabilityBlock = {
  id?: string; // DB
  tempId?: string; // editor
  day_of_week: number;
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  is_active: boolean;
};

/* =====================================================
   ✅ TZ / ISO NORMALIZATION
===================================================== */

/**
 * FullCalendar + Date parsing:
 * - A veces llega desde DB/API: "YYYY-MM-DD HH:MM:SS+00"
 * - Lo convertimos a ISO real: "YYYY-MM-DDTHH:MM:SS+00:00"
 * - Si viene sin TZ, lo convertimos vía Date() a ISOZ (mejor que dejarlo ambiguo).
 */
function normalizeISO(input: any) {
  if (!input) return "";
  const s = String(input).trim();

  // "YYYY-MM-DD HH:MM:SS+00" -> "YYYY-MM-DDTHH:MM:SS+00:00"
  if (s.includes(" ")) {
    let withT = s.replace(" ", "T");

    // +00 / -03 (2 dígitos)
    if (/[+-]\d{2}$/.test(withT)) withT += ":00";

    return withT;
  }

  return s;
}
function toIsoZ(input: any) {
  const isoLike = normalizeISO(input);
  const d = new Date(isoLike);
  if (isNaN(d.getTime())) return "";
  return d.toISOString();
}

/** forzar formateo siempre en TZ admin */
function formatDateTimeRange(startISO: string, endISO: string) {
  const tz = UI_CONFIG.ADMIN_TIMEZONE;
  const start = new Date(startISO);
  const end = new Date(endISO);

  const date = start.toLocaleDateString("es-CL", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const startTime = start.toLocaleTimeString("es-CL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });

  const endTime = end.toLocaleTimeString("es-CL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });

  return { date, startTime, endTime };
}

/* =====================================================
   HELPERS
===================================================== */

function getMondayStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 dom, 1 lun...
  const diffToMonday = (day + 6) % 7; // lunes => 0
  x.setDate(x.getDate() - diffToMonday);
  return x;
}

function weekKey(d: Date) {
  const m = getMondayStart(d);
  const yyyy = m.getFullYear();
  const mm = String(m.getMonth() + 1).padStart(2, "0");
  const dd = String(m.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const dateToMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

const timeToMinutes = (time: string) => {
  const t = time?.slice(0, 5) || "00:00";
  const [hh, mm] = t.split(":").map(Number);
  return hh * 60 + mm;
};

function blockMatchesDateDay(blockDow: number, date: Date) {
  const jsDow = date.getDay(); // 0 dom..6 sab

  if (blockDow === jsDow) return true;

  const dbDow_1_7 = jsDow === 0 ? 7 : jsDow;
  if (blockDow === dbDow_1_7) return true;

  const mon0 = (jsDow + 6) % 7;
  if (blockDow === mon0) return true;

  return false;
}

const isWithinAvailability = (params: {
  startMin: number;
  endMin: number;
  blocks: AvailabilityBlock[];
}) => {
  const { startMin, endMin, blocks } = params;
  return blocks.some((b) => {
    const bs = timeToMinutes(b.start_time);
    const be = timeToMinutes(b.end_time);
    return startMin >= bs && endMin <= be;
  });
};

function getBlocksForDate(blocks: AvailabilityBlock[], date: Date) {
  return blocks.filter(
    (b) => b.is_active && blockMatchesDateDay(b.day_of_week, date),
  );
}

/**
 * ✅ Intersección real:
 * Permite si el rango [startMin,endMin] cabe dentro de
 * algún overlap entre un bloque base y un bloque de reglas servicio.
 */
function isWithinBaseAndService(args: {
  startMin: number;
  endMin: number;
  baseBlocks: AvailabilityBlock[];
  serviceBlocks: AvailabilityBlock[];
}) {
  const { startMin, endMin, baseBlocks, serviceBlocks } = args;

  // Si no hay reglas para el servicio, se usa SOLO base
  if (!serviceBlocks || serviceBlocks.length === 0) {
    return isWithinAvailability({ startMin, endMin, blocks: baseBlocks });
  }

  for (const b of baseBlocks) {
    const bs = timeToMinutes(b.start_time);
    const be = timeToMinutes(b.end_time);

    for (const s of serviceBlocks) {
      const ss = timeToMinutes(s.start_time);
      const se = timeToMinutes(s.end_time);

      const os = Math.max(bs, ss);
      const oe = Math.min(be, se);

      if (os < oe && startMin >= os && endMin <= oe) return true;
    }
  }

  return false;
}

function buildConfirmationMessage(args: {
  customerName: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  businessName?: string;
}) {
  const { customerName, dateLabel, startTime, endTime, businessName } = args;

  const header = businessName
    ? `Hola ${customerName} 👋\nSoy ${businessName}.`
    : `Hola ${customerName} 👋`;

  return `${header}\n\n✅ Tu cita quedó agendada para:\n📅 ${dateLabel}\n🕒 ${startTime} – ${endTime}\n\nSi necesitas reprogramar, responde este mensaje.`;
}

function normalizeDowToJs0_6(dow: number) {
  const n = Number(dow);
  if (!Number.isFinite(n)) return 0;
  if (n >= 1 && n <= 7) return n === 7 ? 0 : n;
  if (n >= 0 && n <= 6) return n;
  return ((n % 7) + 7) % 7;
}

/* =====================================================
   UI mini
===================================================== */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-xs font-semibold text-zinc-900">
      {children}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm">{children}</div>
  );
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="p-3">{children}</div>;
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 items-center justify-center rounded-xl border bg-white px-3 text-sm font-semibold hover:bg-muted"
      type="button"
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
      type="button"
    >
      {children}
    </button>
  );
}

/* =====================================================
   PAGE
===================================================== */

export default function AgendaPage() {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar | null>(null);

  const [viewDate, setViewDate] = useState<Date>(() =>
    getMondayStart(new Date()),
  );

  // tenant
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [loadingTenant, setLoadingTenant] = useState(true);
  const [tenantLogoUrl, setTenantLogoUrl] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [tenantPaymentMode, setTenantPaymentMode] =
    useState<TenantPaymentMode>("none");
  const [tenantChargeType, setTenantChargeType] =
    useState<TenantChargeType>("none");
  const [tenantDepositValue, setTenantDepositValue] = useState("");
  const [paymentMethodsEnabled, setPaymentMethodsEnabled] = useState<
    PaymentProviderId[]
  >(["mercadopago"]);
  const [webpayCommerceCode, setWebpayCommerceCode] = useState("");
  const [webpayApiKey, setWebpayApiKey] = useState("");
  const [webpayApiKeyPreview, setWebpayApiKeyPreview] = useState("");
  const [webpayEnvironment, setWebpayEnvironment] = useState<
    "integration" | "production"
  >("integration");
  const [khipuReceiverId, setKhipuReceiverId] = useState("");
  const [khipuSecret, setKhipuSecret] = useState("");
  const [khipuSecretPreview, setKhipuSecretPreview] = useState("");
  const [khipuEnvironment, setKhipuEnvironment] = useState<
    "development" | "production"
  >("development");
  const [bankName, setBankName] = useState("");
  const [bankAccountType, setBankAccountType] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankRut, setBankRut] = useState("");
  const [bankEmail, setBankEmail] = useState("");
  const [savingPaymentMode, setSavingPaymentMode] = useState(false);

  // auth
  const [authChecked, setAuthChecked] = useState(false);

  // professionals
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState("");

  const selectedProfessional = useMemo(
    () => professionals.find((p) => p.id === selectedProfessionalId) ?? null,
    [professionals, selectedProfessionalId],
  );
  const proName = selectedProfessional?.name ?? "(sin nombre)";

  // customers
  const [customers, setCustomers] = useState<CustomerLite[]>([]);

  // availability (base)
  const [availabilityBlocks, setAvailabilityBlocks] = useState<
    AvailabilityBlock[]
  >([]);
  const [savingAvailability, setSavingAvailability] = useState(false);

  // services + rules (panel de reglas)
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>(""); // servicio seleccionado SOLO para editar reglas
  const [serviceRulesBlocks, setServiceRulesBlocks] = useState<
    AvailabilityBlock[]
  >([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingServiceRules, setLoadingServiceRules] = useState(false);
  const [savingServiceRules, setSavingServiceRules] = useState(false);
  const [serviceRulesError, setServiceRulesError] = useState<string>("");

  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

  // appointments
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleRange, setVisibleRange] = useState<{
    start: string;
    end: string;
  } | null>(null);

  // modals
  const [createOpen, setCreateOpen] = useState(false);
  const [slot, setSlot] = useState<{ startISO: string; endISO: string } | null>(
    null,
  );

  const [actionOpen, setActionOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<{
    id: string;
    title: string;
    customerPhone: string | null;
    customerId: string | null;
    startISO: string;
    endISO: string;
  } | null>(null);

  const isDebug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";

  const tenantChargeUiType: TenantChargeUiType =
    tenantChargeType === "fixed" || tenantChargeType === "percentage"
      ? "deposit"
      : tenantChargeType;
  const tenantDepositUiType: TenantDepositUiType =
    tenantChargeType === "percentage" ? "percentage" : "fixed";

  const apptAbortRef = useRef<AbortController | null>(null);

  /* =====================================================
     TENANT
  ===================================================== */

  useEffect(() => {
    const run = async () => {
      setLoadingTenant(true);
      setTenantError("");
      setTenantSlug("");
      setTenantId("");

      const hostname = window.location.hostname;
      const slug = getTenantSlugFromHostname(hostname);

      if (!slug) {
        setTenantError(
          "Este panel debe abrirse desde el subdominio del cliente (ej: https://fajaspaola.citaya.online/admin/agenda).",
        );
        setLoadingTenant(false);
        return;
      }

      setTenantSlug(slug);

      const { data, error } = await supabase
        .from("tenants")
        .select("id, slug, name, logo_url")
        .eq("slug", slug)
        .maybeSingle();

      if (error) {
        setTenantError(`Error buscando cliente (${slug}): ${error.message}`);
        setLoadingTenant(false);
        return;
      }

      if (!data?.id) {
        setTenantError(`No existe un cliente configurado para: ${slug}`);
        setLoadingTenant(false);
        return;
      }

      setTenantId(data.id);
      setTenantLogoUrl(data.logo_url ?? "");
      setTenantName(data.name ?? "");
      setLoadingTenant(false);
    };

    run();
  }, []);

  /* =====================================================
     AUTH
  ===================================================== */

  useEffect(() => {
    const run = async () => {
      if (loadingTenant) return;
      if (tenantError) return;
      if (!tenantId) return;

      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        const redirectTo = `${window.location.pathname}${window.location.search || ""}`;
        router.push(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
        return;
      }

      setAuthChecked(true);
    };

    run();
  }, [router, loadingTenant, tenantError, tenantId]);

  useEffect(() => {
    const run = async () => {
      if (!authChecked || !tenantId) return;

      try {
        const res = await fetch(
          `/api/admin/payment-settings?tenantId=${encodeURIComponent(tenantId)}`,
          { cache: "no-store" },
        );
        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? "No se pudo cargar payment settings");
        }

        setTenantPaymentMode(
          (json.settings?.paymentMode as TenantPaymentMode | undefined) ?? "none",
        );
        const depositType =
          (json.settings?.depositType as TenantDepositType | undefined) ?? null;
        const depositValue = json.settings?.depositValue;
        const paymentMode =
          (json.settings?.paymentMode as TenantPaymentMode | undefined) ?? "none";

        setTenantChargeType(
          paymentMode === "none"
            ? "none"
            : depositType === "fixed"
              ? "fixed"
              : depositType === "percentage"
                ? "percentage"
                : "full",
        );
        setTenantDepositValue(
          depositValue !== null && depositValue !== undefined
            ? String(depositValue)
            : "",
        );
        const methods = Array.isArray(json.settings?.paymentMethodsEnabled)
          ? json.settings.paymentMethodsEnabled.filter(
              (method: unknown): method is PaymentProviderId =>
                method === "mercadopago" ||
                method === "webpay" ||
                method === "khipu" ||
                method === "manual",
            )
          : [];
        setPaymentMethodsEnabled(methods.length > 0 ? methods : ["mercadopago"]);
        setWebpayCommerceCode(json.settings?.webpayCommerceCode ?? "");
        setWebpayApiKey("");
        setWebpayApiKeyPreview(json.settings?.webpayApiKeyPreview ?? "");
        setWebpayEnvironment(
          json.settings?.webpayEnvironment === "production"
            ? "production"
            : "integration",
        );
        setKhipuReceiverId(json.settings?.khipuReceiverId ?? "");
        setKhipuSecret("");
        setKhipuSecretPreview(json.settings?.khipuSecretPreview ?? "");
        setKhipuEnvironment(
          json.settings?.khipuEnvironment === "production"
            ? "production"
            : "development",
        );
        setBankName(json.settings?.bankName ?? "");
        setBankAccountType(json.settings?.bankAccountType ?? "");
        setBankAccountNumber(json.settings?.bankAccountNumber ?? "");
        setBankAccountHolder(json.settings?.bankAccountHolder ?? "");
        setBankRut(json.settings?.bankRut ?? "");
        setBankEmail(json.settings?.bankEmail ?? "");
      } catch (error) {
        console.error("[admin/agenda] payment settings error:", error);
      }
    };

    void run();
  }, [authChecked, tenantId]);

  /* =====================================================
     LOADERS
  ===================================================== */

  const loadProfessionals = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/professionals/list`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Error loading professionals (API):", json);
        return;
      }

      const list = (json?.professionals ?? []) as Professional[];
      const filtered = list.filter(
        (p) => !p.tenant_id || p.tenant_id === tenantId,
      );

      setProfessionals(filtered);
      setSelectedProfessionalId((prev) => {
        const exists = filtered.some((p) => p.id === prev);
        if (exists) return prev;
        return filtered[0]?.id ?? "";
      });
    } catch (e) {
      console.error("Error loading professionals:", e);
    }
  }, [tenantId]);

  const loadCustomers = useCallback(async () => {
    if (!tenantId) return;

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      if (!token) {
        console.error("No session token (customers).");
        setCustomers([]);
        return;
      }

      const res = await fetch(`/api/customers/list?tenantId=${tenantId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        console.error("Error loading customers (API):", json);
        setCustomers([]);
        return;
      }

      const rows = (json.customers ?? []) as Array<{
        id: string;
        full_name: string;
        phone: string | null;
        email: string | null;
      }>;

      const list: CustomerLite[] = rows.map((c) => ({
        id: c.id,
        name: c.full_name,
        phone: c.phone ?? null,
        email: c.email ?? null,
      }));

      setCustomers(list);
    } catch (e: any) {
      console.error("Error loading customers (fetch):", e?.message || e);
      setCustomers([]);
    }
  }, [tenantId]);

  const loadAvailability = useCallback(
    async (professionalId: string) => {
      try {
        const qs = new URLSearchParams();
        qs.set("professionalId", professionalId);
        qs.set("tenantId", tenantId);

        const res = await fetch(
          `/api/admin/availability/list?${qs.toString()}`,
          { cache: "no-store" },
        );

        const json = await res.json().catch(() => null);
        if (!res.ok) {
          console.error("Error loading availability:", json);
          setAvailabilityBlocks([]);
          return;
        }

        const items = (json?.items ?? []) as Array<{
          id?: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          is_active: boolean;
        }>;

        const blocks: AvailabilityBlock[] = items.map((x) => ({
          id: x.id,
          day_of_week: Number(x.day_of_week),
          start_time: String(x.start_time).slice(0, 5),
          end_time: String(x.end_time).slice(0, 5),
          is_active: !!x.is_active,
        }));

        setAvailabilityBlocks(blocks);
      } catch (e) {
        console.error("Error loadAvailability:", e);
        setAvailabilityBlocks([]);
      }
    },
    [tenantId],
  );

  const saveAvailability = async () => {
    if (!selectedProfessionalId) return;

    setSavingAvailability(true);
    try {
      const payload = {
        professionalId: selectedProfessionalId,
        tenantId,
        items: availabilityBlocks.map((b) => ({
          id: b.id ?? null,
          day_of_week: normalizeDowToJs0_6(b.day_of_week),
          start_time: (b.start_time || "").slice(0, 5),
          end_time: (b.end_time || "").slice(0, 5),
          is_active: !!b.is_active,
        })),
      };

      const res = await fetch("/api/admin/availability/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(json?.error ?? "No se pudo guardar disponibilidad");

      toast({
        title: "Horarios guardados",
        description: "Disponibilidad actualizada.",
      });
      await loadAvailability(selectedProfessionalId);
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Error guardando horarios",
        description: e?.message ?? "No se pudo guardar",
        variant: "destructive",
      });
    } finally {
      setSavingAvailability(false);
    }
  };

  const loadAppointments = useCallback(
    async (start?: string, end?: string, professionalId?: string) => {
      if (!tenantId) return;

      if (apptAbortRef.current) apptAbortRef.current.abort();
      const ac = new AbortController();
      apptAbortRef.current = ac;

      setLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set("tenantId", tenantId);
        if (professionalId) qs.set("professionalId", professionalId);
        if (start) qs.set("start", start);
        if (end) qs.set("end", end);

        const res = await fetch(
          `/api/admin/appointments/range?${qs.toString()}`,
          {
            cache: "no-store",
            signal: ac.signal,
          },
        );

        const json = await res.json().catch(() => null);

        if (!res.ok) {
          console.error("Error loading appointments (API):", json);
          setEvents([]);
          return;
        }

        const visibleItems = (json?.items ?? []).filter(
          (a: any) => a.status !== "canceled",
        );

        const mapped: CalendarEvent[] = visibleItems.map((a: any) => {
          const titleBase = a.customer_name ?? "Cita";
          const status = (a.status ?? "confirmed") as AppointmentStatus;

          return {
            id: a.id,
            title: titleBase,
            start: toIsoZ(a.start_at),
            end: toIsoZ(a.end_at),
            classNames: ["citaya-event", `citaya-status-${status}`],
            extendedProps: {
              professional_id: a.professional_id,
              service_id: a.service_id ?? null,
              customer_phone: a.customer_phone ?? null,
              customer_name: a.customer_name ?? null,
              status,
              customer_id: a.customer_id ?? null,
            },
          };
        });

        setEvents(mapped);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.error("loadAppointments error:", e);
          setEvents([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [tenantId],
  );

  const loadServices = useCallback(async () => {
    if (!tenantId) return;

    setLoadingServices(true);
    setServiceRulesError("");

    try {
      const qs = new URLSearchParams();
      qs.set("tenantId", tenantId);

      const res = await fetch(`/api/admin/services/list?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!res.ok)
        throw new Error(json?.error ?? "No se pudieron cargar servicios.");

      const list = (json?.services ?? []) as Service[];
      const active = list.filter((s) => (s.is_active ?? true) === true);

      setServices(active);
      setSelectedServiceId((prev) => {
        if (prev && active.some((s) => s.id === prev)) return prev;
        return active[0]?.id ?? "";
      });
    } catch (e: any) {
      console.error("loadServices error:", e);
      setServices([]);
      setSelectedServiceId("");
      setServiceRulesError(e?.message ?? "No se pudieron cargar servicios.");
    } finally {
      setLoadingServices(false);
    }
  }, [tenantId]);

  const loadServiceRules = useCallback(
    async (professionalId: string, serviceId: string) => {
      if (!tenantId || !professionalId || !serviceId) {
        setServiceRulesBlocks([]);
        return;
      }

      setLoadingServiceRules(true);
      setServiceRulesError("");

      try {
        const qs = new URLSearchParams();
        qs.set("tenantId", tenantId);
        qs.set("professionalId", professionalId);
        qs.set("serviceId", serviceId);

        const res = await fetch(
          `/api/admin/service-rules/list?${qs.toString()}`,
          { cache: "no-store" },
        );

        const json = await res.json().catch(() => null);
        if (!res.ok)
          throw new Error(
            json?.error ?? "No se pudieron cargar reglas del servicio.",
          );

        const rows = (json?.items ?? []) as Array<{
          id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          is_active: boolean;
        }>;

        const blocks: AvailabilityBlock[] = rows.map((r) => ({
          id: r.id,
          day_of_week: Number(r.day_of_week),
          start_time: String(r.start_time).slice(0, 5),
          end_time: String(r.end_time).slice(0, 5),
          is_active: !!r.is_active,
        }));

        setServiceRulesBlocks(blocks);
      } catch (e: any) {
        console.error("loadServiceRules error:", e);
        setServiceRulesBlocks([]);
        setServiceRulesError(
          e?.message ?? "No se pudieron cargar reglas por servicio.",
        );
      } finally {
        setLoadingServiceRules(false);
      }
    },
    [tenantId],
  );

  const saveServiceRules = useCallback(async () => {
    if (!tenantId) return;
    if (!selectedProfessionalId) return;

    if (!selectedServiceId) {
      toast({
        title: "Selecciona un servicio",
        description: "Elige un servicio para editar sus reglas de horario.",
        variant: "destructive",
      });
      return;
    }

    setSavingServiceRules(true);
    setServiceRulesError("");

    try {
      const payload = {
        tenantId,
        professionalId: selectedProfessionalId,
        serviceId: selectedServiceId,
        items: serviceRulesBlocks.map((b) => {
          const row: any = {
            day_of_week: normalizeDowToJs0_6(b.day_of_week),
            start_time: (b.start_time || "").slice(0, 5),
            end_time: (b.end_time || "").slice(0, 5),
            is_active: !!b.is_active,
          };
          if (b.id) row.id = b.id;
          return row;
        }),
      };

      const res = await fetch("/api/admin/service-rules/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(json?.error ?? "No se pudieron guardar reglas");

      toast({
        title: "Reglas guardadas",
        description: "Horario por servicio actualizado.",
      });
      await loadServiceRules(selectedProfessionalId, selectedServiceId);
    } catch (e: any) {
      console.error("saveServiceRules error:", e);
      toast({
        title: "Error guardando reglas",
        description: e?.message ?? "No se pudo guardar reglas por servicio.",
        variant: "destructive",
      });
      setServiceRulesError(
        e?.message ?? "No se pudo guardar reglas por servicio.",
      );
    } finally {
      setSavingServiceRules(false);
    }
  }, [
    tenantId,
    selectedProfessionalId,
    selectedServiceId,
    serviceRulesBlocks,
    loadServiceRules,
  ]);

  useEffect(() => {
    if (!authChecked) return;
    if (!tenantId) return;
    loadProfessionals();
    loadCustomers();
    loadServices();
  }, [authChecked, tenantId, loadProfessionals, loadCustomers, loadServices]);

  useEffect(() => {
    if (!authChecked) return;
    if (!tenantId) return;
    if (!selectedProfessionalId) return;
    loadAvailability(selectedProfessionalId);
  }, [authChecked, tenantId, selectedProfessionalId, loadAvailability]);

  useEffect(() => {
    if (!authChecked) return;
    if (!tenantId) return;
    if (!selectedProfessionalId) return;

    if (!selectedServiceId) {
      setServiceRulesBlocks([]);
      return;
    }

    loadServiceRules(selectedProfessionalId, selectedServiceId);
  }, [
    authChecked,
    tenantId,
    selectedProfessionalId,
    selectedServiceId,
    loadServiceRules,
  ]);

  useEffect(() => {
    if (!authChecked) return;
    if (!tenantId) return;
    if (!selectedProfessionalId) return;

    if (visibleRange)
      loadAppointments(
        visibleRange.start,
        visibleRange.end,
        selectedProfessionalId,
      );
    else loadAppointments(undefined, undefined, selectedProfessionalId);
  }, [
    authChecked,
    tenantId,
    selectedProfessionalId,
    visibleRange?.start,
    visibleRange?.end,
    loadAppointments,
  ]);

  /* =====================================================
     ACTIONS
  ===================================================== */

  const onLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const hasOverlap = async (
    startISO: string,
    endISO: string,
    professionalId: string,
    excludeId?: string,
  ) => {
    let q = supabase
      .from("appointments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("professional_id", professionalId)
      .eq("booking_status", "confirmed")
      .lt("start_at", endISO)
      .gt("end_at", startISO);

    if (excludeId) q = q.neq("id", excludeId);

    const { data, error } = await q;
    if (error) {
      console.error("Overlap check error:", error);
      return true;
    }

    return (data?.length ?? 0) > 0;
  };

  const handleSelect = async (selectInfo: DateSelectArg) => {
    if (!selectedProfessionalId) {
      toast({ title: "Selecciona un profesional primero", variant: "destructive" });
      return;
    }

    const startDate = selectInfo.start;
    const endDate = selectInfo.end;

    const start_at = startDate.toISOString();
    const end_at = endDate.toISOString();

    const startMin = dateToMinutes(startDate);
    const endMin = dateToMinutes(endDate);

    const baseBlocks = getBlocksForDate(availabilityBlocks, startDate);
    const serviceBlocks = selectedServiceId
      ? getBlocksForDate(serviceRulesBlocks, startDate)
      : [];

    // ✅ aquí todavía validamos con el servicio del PANEL (si existe),
    // pero igual abrimos modal siempre (servicio real se elige en el modal).
    const okByBase = isWithinAvailability({
      startMin,
      endMin,
      blocks: baseBlocks,
    });

    if (!okByBase) {
      toast({ title: "Fuera de disponibilidad", description: "El horario esta fuera de disponibilidad del profesional.", variant: "destructive" });
      return;
    }

    const okByRules = isWithinBaseAndService({
      startMin,
      endMin,
      baseBlocks,
      serviceBlocks,
    });

    if (!okByRules) {
      const hasServiceRules = serviceRulesBlocks.some((b) => b.is_active);

      toast({
        title: "Fuera de disponibilidad",
        description:
          hasServiceRules && selectedServiceId
            ? "Fuera del horario permitido por este servicio."
            : "Fuera de disponibilidad del profesional.",
        variant: "destructive",
      });
      return;
    }

    const overlap = await hasOverlap(start_at, end_at, selectedProfessionalId);
    if (overlap) {
      toast({ title: "Horario ocupado", description: "Ya existe una cita en ese horario.", variant: "destructive" });
      return;
    }

    setSlot({ startISO: start_at, endISO: end_at });
    setCreateOpen(true);
  };

  async function createAppointmentViaApi(payload: {
    tenantId: string;
    professionalId: string;

    startAt: string;
    endAt: string;

    customerId?: string | null;
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;

    serviceId?: string | null;
  }) {
    const res = await fetch("/api/appointments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? "Error creando cita");
    return json;
  }

  async function createAppointmentWithCustomer(args: {
    customerId: string;
    serviceId: string;
  }) {
    if (!slot) return;

    const customer = customers.find((c) => c.id === args.customerId) ?? null;

    try {
      const customer_email = String(customer?.email ?? "")
        .trim()
        .toLowerCase();
      if (
        !customer_email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)
      ) {
        toast({
          title: "Email inválido",
          description: "Este cliente no tiene un email válido guardado.",
          variant: "destructive",
        });
        return;
      }

      const payload = {
        tenantId,
        professionalId: selectedProfessionalId,
        startAt: slot.startISO,
        endAt: slot.endISO,

        customerId: customer?.id ?? null,
        customerName: customer?.name ?? "",
        customerPhone: customer?.phone ?? null,
        customerEmail: customer?.email ?? null,

        // ✅ servicio SIEMPRE desde el modal (fuente de verdad)
        serviceId: args.serviceId,
      };

      if (!payload.customerName) {
        toast({
          title: "Cliente incompleto",
          description: "Este cliente no tiene nombre guardado.",
          variant: "destructive",
        });
        return;
      }

      await createAppointmentViaApi(payload);

      toast({ title: "Cita creada", description: "Se guardó correctamente." });
    } catch (e: any) {
      console.error(e);
      toast({
        title: "No se pudo crear la cita",
        description: e?.message ?? "Error creando cita",
        variant: "destructive",
      });
      return;
    }

    setCreateOpen(false);
    setSlot(null);

    if (visibleRange)
      await loadAppointments(
        visibleRange.start,
        visibleRange.end,
        selectedProfessionalId,
      );
    else await loadAppointments(undefined, undefined, selectedProfessionalId);
  }

  const handleEventDrop = async (dropInfo: EventDropArg) => {
    const id = dropInfo.event.id;
    const startDate = dropInfo.event.start;
    const endDate = dropInfo.event.end;

    if (!startDate || !endDate) {
      toast({
        title: "Rango inválido",
        description: "La cita no tiene un rango horario válido.",
        variant: "destructive",
      });
      dropInfo.revert();
      return;
    }

    // ✅ UTC ISOZ siempre
    const start_at = startDate.toISOString();
    const end_at = endDate.toISOString();

    const startMin = dateToMinutes(startDate);
    const endMin = dateToMinutes(endDate);

    // ✅ base
    const baseBlocks = getBlocksForDate(availabilityBlocks, startDate);

    // ✅ service_id desde el evento (viene del range endpoint)
    const props = (dropInfo.event.extendedProps ?? {}) as {
      service_id?: string | null;
    };
    const eventServiceId = props.service_id ?? null;

    // ✅ si no tiene service_id, no permitimos mover (para evitar saltarse reglas)
    if (!eventServiceId) {
      toast({
        title: "No se puede mover",
        description:
          "Esta cita no tiene servicio asociado. Edita la cita o re-crea con servicio.",
        variant: "destructive",
      });
      dropInfo.revert();
      return;
    }

    // ✅ reglas por servicio: cargamos en caliente para el servicio del evento
    // (no depende del selectedServiceId del UI)
    let serviceBlocks: AvailabilityBlock[] = [];
    try {
      const qs = new URLSearchParams();
      qs.set("tenantId", tenantId);
      qs.set("professionalId", selectedProfessionalId);
      qs.set("serviceId", eventServiceId);

      const res = await fetch(
        `/api/admin/service-rules/list?${qs.toString()}`,
        {
          cache: "no-store",
        },
      );
      const json = await res.json().catch(() => null);

      if (res.ok) {
        const rows = (json?.items ?? []) as Array<{
          id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          is_active: boolean;
        }>;

        serviceBlocks = rows.map((r) => ({
          id: r.id,
          day_of_week: Number(r.day_of_week),
          start_time: String(r.start_time).slice(0, 5),
          end_time: String(r.end_time).slice(0, 5),
          is_active: !!r.is_active,
        }));
      }
    } catch (e) {
      // si falla el fetch de reglas, por seguridad NO movemos
      console.error("service rules fetch error (drop)", e);
      toast({
        title: "No se pudo validar reglas",
        description: "No se pudo validar el horario del servicio. Se revirtió.",
        variant: "destructive",
      });
      dropInfo.revert();
      return;
    }

    // ✅ validación final = base ∩ reglas (si existen)
    const okByRules = isWithinBaseAndService({
      startMin,
      endMin,
      baseBlocks,
      serviceBlocks: getBlocksForDate(serviceBlocks, startDate),
    });

    if (!okByRules) {
      const hasServiceRules = (serviceBlocks ?? []).some((b) => b.is_active);

      toast({
        title: "Movimiento no permitido",
        description: hasServiceRules
          ? "Fuera del horario permitido por este servicio (base ∩ reglas)."
          : "Fuera de disponibilidad del profesional.",
        variant: "destructive",
      });
      dropInfo.revert();
      return;
    }

    const overlap = await hasOverlap(
      start_at,
      end_at,
      selectedProfessionalId,
      id,
    );
    if (overlap) {
      toast({
        title: "Horario ocupado",
        description: "Ese horario ya está reservado.",
        variant: "destructive",
      });
      dropInfo.revert();
      return;
    }

    try {
      const res = await fetch("/api/appointments/reschedule-by-id", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          appointment_id: id,
          new_start_at: start_at,
          new_end_at: end_at,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        toast({
          title: "No se pudo reagendar",
          description:
            data?.error ?? "El servidor rechazó el cambio. Se revirtió.",
          variant: "destructive",
        });
        dropInfo.revert();
        return;
      }
    } catch (err) {
      console.error("reschedule-by-id error", err);
      toast({
        title: "Error de conexión",
        description: "No se pudo contactar al servidor. Se revirtió.",
        variant: "destructive",
      });
      dropInfo.revert();
      return;
    }

    if (visibleRange)
      await loadAppointments(
        visibleRange.start,
        visibleRange.end,
        selectedProfessionalId,
      );
    else await loadAppointments(undefined, undefined, selectedProfessionalId);
  };

  async function cancelAppointment(appointmentId: string) {
    try {
      const res = await fetch("/api/appointments/cancel-by-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          appointment_id: appointmentId,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        console.error("Cancel API error:", json);
        toast({
          title: "No se pudo cancelar",
          description: json?.error ?? "Error cancelando cita",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Cita cancelada",
        description: "La cita fue cancelada correctamente.",
      });

      if (visibleRange)
        await loadAppointments(
          visibleRange.start,
          visibleRange.end,
          selectedProfessionalId,
        );
      else await loadAppointments(undefined, undefined, selectedProfessionalId);
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Error de conexión",
        description: e?.message ?? "Error cancelando cita",
        variant: "destructive",
      });
    }
  }

  const handleEventClick = async (clickInfo: EventClickArg) => {
    const id = clickInfo.event.id;
    const title = clickInfo.event.title;

    const props = (clickInfo.event.extendedProps ?? {}) as {
      customer_phone?: string | null;
      customer_id?: string | null;
    };

    const customerPhone = props.customer_phone ?? null;
    const customerId = props.customer_id ?? null;

    const startISO = clickInfo.event.start?.toISOString() ?? "";
    const endISO = clickInfo.event.end?.toISOString() ?? "";

    setSelectedEvent({
      id,
      title,
      customerPhone,
      customerId,
      startISO,
      endISO,
    });
    setActionOpen(true);
  };

  const saveTenantPaymentMode = async () => {
    if (!tenantId || savingPaymentMode) return;

    const nextPaymentMode: TenantPaymentMode =
      tenantChargeType === "none"
        ? "none"
        : tenantPaymentMode === "none"
          ? "required"
          : tenantPaymentMode;
    const nextDepositType: TenantDepositType =
      tenantChargeType === "fixed"
        ? "fixed"
        : tenantChargeType === "percentage"
          ? "percentage"
          : null;
    const rawDepositValue = tenantDepositValue.trim();
    const nextDepositValue =
      nextDepositType && rawDepositValue ? Number(rawDepositValue) : null;
    const paymentCollectionMode =
      tenantChargeType === "none"
        ? "none"
        : tenantChargeType === "full"
          ? "full"
          : "deposit";

    if (paymentMethodsEnabled.length === 0) {
      toast({
        title: "Método de pago requerido",
        description: "Selecciona al menos un método de pago.",
        variant: "destructive",
      });
      return;
    }

    if (nextDepositType) {
      const numericDepositValue = Number(nextDepositValue);

      if (!Number.isFinite(numericDepositValue) || numericDepositValue <= 0) {
        toast({
          title: "Monto inválido",
          description:
            nextDepositType === "fixed"
              ? "Ingresa un abono fijo mayor a 0."
              : "Ingresa un porcentaje mayor a 0.",
          variant: "destructive",
        });
        return;
      }

      if (nextDepositType === "percentage" && numericDepositValue > 100) {
        toast({
          title: "Porcentaje inválido",
          description: "El abono por porcentaje no puede ser mayor a 100%.",
          variant: "destructive",
        });
        return;
      }
    }

    setSavingPaymentMode(true);

    try {
      const res = await fetch("/api/admin/payment-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          paymentMode: nextPaymentMode,
          depositType: nextDepositType,
          depositValue: nextDepositValue,
          paymentMethodsEnabled,
          paymentCollectionMode,
          webpayCommerceCode,
          webpayApiKey,
          webpayEnvironment,
          khipuReceiverId,
          khipuSecret,
          khipuEnvironment,
          bankName,
          bankAccountType,
          bankAccountNumber,
          bankAccountHolder,
          bankRut,
          bankEmail,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "No se pudo guardar payment_mode");
      }

      toast({
        title: "Cobros actualizados",
        description:
          nextPaymentMode === "none"
            ? "El tenant quedó sin pago online."
            : nextPaymentMode === "optional"
              ? "El tenant quedó con pago online opcional."
              : "El tenant quedó con pago online obligatorio.",
      });
      setTenantPaymentMode(nextPaymentMode);
    } catch (error: unknown) {
      console.error("[admin/agenda] save payment settings error:", error);
      toast({
        title: "No se pudo guardar",
        description:
          error instanceof Error ? error.message : "Error guardando payment_mode",
        variant: "destructive",
      });
    } finally {
      setSavingPaymentMode(false);
    }
  };

  const handleDatesSet = (arg: DatesSetArg) => {
    const startStr = arg.startStr;
    const datePart = startStr.slice(0, 10);
    const [y, m, d] = datePart.split("-").map(Number);

    const safeLocal = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
    const monday = getMondayStart(safeLocal);

    setViewDate((prev) => (weekKey(prev) === weekKey(monday) ? prev : monday));
    setVisibleRange({ start: arg.startStr, end: arg.endStr });
  };

  /* =====================================================
     RENDER guards
  ===================================================== */

  if (tenantError) {
    return (
      <main className="min-h-screen bg-[#f6f7fb]">
        <div className="mx-auto max-w-3xl p-6">
          <Card>
            <CardBody>
              <div className="text-lg font-extrabold">⚠️ Acceso inválido</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {tenantError}
              </div>
              <div className="mt-4">
                <Link
                  href="https://app.citaya.online"
                  className="inline-flex h-9 items-center rounded-xl border bg-white px-3 text-sm font-semibold hover:bg-muted"
                >
                  Ir al dominio principal
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    );
  }

  if (loadingTenant) {
    return (
      <main className="min-h-screen bg-[#f6f7fb]">
        <div className="mx-auto max-w-3xl p-6">
          <Card>
            <CardBody>
              <div className="text-lg font-extrabold">Cargando panel…</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Resolviendo cliente (subdominio)…
              </div>
              <div className="mt-4 h-2 rounded-full bg-muted" />
            </CardBody>
          </Card>
        </div>
      </main>
    );
  }

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-[#f6f7fb]">
        <div className="mx-auto max-w-3xl p-6">
          <Card>
            <CardBody>
              <div className="text-lg font-extrabold">Cargando…</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Resolviendo cliente: <b>{tenantSlug || "—"}</b>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    );
  }

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-[#f6f7fb]">
        <div className="mx-auto max-w-3xl p-6">
          <Card>
            <CardBody>
              <div className="text-lg font-extrabold">Validando sesión…</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Si no estás autenticado, te redirigiremos a Login.
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    );
  }

  /* =====================================================
     MAIN
  ===================================================== */

  return (
    <main className="min-h-screen overflow-x-clip bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.06),transparent_24%),linear-gradient(180deg,#eef3f8_0%,#f8fafc_22%,#eef3f8_100%)]">
      <style>{`
  .fc { font-family: system-ui; }
  .fc .fc-toolbar-title { font-size: 16px; font-weight: 800; }
  .fc .fc-timegrid-slot-label { font-size: 12px; opacity: 0.75; }
  .fc .fc-timegrid-axis-cushion { font-size: 12px; opacity: 0.75; }
  .fc .fc-col-header-cell-cushion { font-size: 12px; font-weight: 800; color: #111827; }
  .fc .fc-event {
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.22);
    padding: 0;
    box-shadow: 0 8px 18px rgba(15,23,42,0.10);
    overflow: hidden;
  }
  .citaya-event .fc-event-main { font-weight: 650; }
  .citaya-status-confirmed {
    border-color: #2563eb !important;
    background: linear-gradient(180deg,#3b82f6 0%,#2563eb 100%) !important;
    z-index: 4 !important;
  }
  .citaya-status-canceled {
    border-color: rgba(148,163,184,0.45) !important;
    background: linear-gradient(180deg,rgba(203,213,225,0.72) 0%,rgba(148,163,184,0.72) 100%) !important;
    opacity: 0.55;
    z-index: 1 !important;
    box-shadow: none !important;
  }
  .citaya-status-completed { border-color: #16a34a !important; background: #22c55e !important; }
  .citaya-status-no_show { border-color: #ef4444 !important; background: #f87171 !important; }

  .fc .fc-timegrid-event.citaya-status-canceled {
    border-radius: 999px !important;
  }

  .fc .fc-timegrid-event.citaya-status-canceled .fc-event-main {
    justify-content: center;
    padding: 2px 6px;
  }

  /* ===============================
     ✅ FIX burbujas legibles (PC + mobile)
  ================================ */
  .fc .fc-timegrid-event .fc-event-main {
    height: 100%;
    min-height: 100%;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 2px;
    overflow: hidden;
  }

  .fc .fc-timegrid-event .fc-event-time {
    font-size: 10px;
    line-height: 1.05;
    opacity: 0.96;
    font-weight: 800;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fc .fc-timegrid-event .fc-event-title {
    font-size: 11px;
    line-height: 1.1;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .citaya-event-content {
    height: 100%;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    overflow: hidden;
    line-height: 1.05;
  }

  .citaya-event-name {
    width: 100%;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .citaya-event-pill {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-height: 16px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (min-width: 1024px) {
    .fc .fc-timegrid-event .fc-event-title {
      font-size: 12px;
    }
    .fc .fc-timegrid-event .fc-event-time {
      font-size: 11px;
    }
    .fc .fc-timegrid-event .fc-event-main {
      padding: 5px 7px;
    }
    .fc .fc-event {
      border-radius: 12px;
    }
    .citaya-event-name { font-size: 14px; }
    .citaya-event-pill { font-size: 10px; }
  }
`}</style>

      <AdminAgendaHeader
        tenantName={tenantSlug}
        tenantLogoUrl={tenantLogoUrl}
        date={viewDate}
        onToday={() => calendarRef.current?.getApi()?.today()}
        onPrevDay={() => calendarRef.current?.getApi()?.prev()}
        onNextDay={() => calendarRef.current?.getApi()?.next()}
        onNewAppointment={() => router.push("/admin/customers/new")}
        rightSlot={
          <button
            type="button"
            onClick={onLogout}
            className="h-8 rounded-md border bg-white px-3 text-sm font-medium hover:bg-muted"
          >
            Cerrar sesión
          </button>
        }
        subSlot={
          <>
            <Badge>Cliente: {tenantSlug}</Badge>
            <Badge>Profesional: {proName}</Badge>
            <Badge>Vista: Semana</Badge>
            {selectedServiceId ? (
              <Badge>Servicio reglas: {selectedService?.name ?? "—"}</Badge>
            ) : (
              <Badge>Servicio reglas: (sin seleccionar)</Badge>
            )}
            {isDebug ? <Badge>Tenant ID: {tenantId}</Badge> : null}
            {loading ? <Badge>Cargando…</Badge> : null}
          </>
        }
      />

      <div className="mx-auto max-w-[1280px] px-3 py-4 sm:px-4 sm:py-5">
        <AdminNav />
        {/* Selector profesional + Horarios base */}
        <div className="mt-3">
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-end gap-4">
                <div className="min-w-[280px]">
                  <div className="mb-2 text-xs font-extrabold text-muted-foreground">
                    Profesional
                  </div>
                  <select
                    value={selectedProfessionalId}
                    onChange={(e) => setSelectedProfessionalId(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white/92 px-3 text-sm font-semibold shadow-[0_8px_18px_rgba(15,23,42,0.05)]"
                  >
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name ?? "(sin nombre)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex-1" />

                <PrimaryButton
                  onClick={saveAvailability}
                  disabled={savingAvailability || !selectedProfessionalId}
                >
                  {savingAvailability
                    ? "Guardando…"
                    : "Guardar horarios (base)"}
                </PrimaryButton>
              </div>

              <div className="mt-3 text-sm font-extrabold">
                Horarios base (vista semanal)
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Estos horarios definen el marco general del profesional.
              </div>

              <div className="mt-3">
                <WeeklyAvailabilityCalendar
                  key={`base:${selectedProfessionalId}:${weekKey(viewDate)}`}
                  weekDate={viewDate}
                  blocks={availabilityBlocks}
                  timeZone={UI_CONFIG.ADMIN_TIMEZONE}
                  onChangeBlocks={(next) => setAvailabilityBlocks(next)}
                  slotMinTime={UI_CONFIG.SLOT_MIN_TIME}
                  slotMaxTime={UI_CONFIG.SLOT_MAX_TIME}
                />
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Reglas por servicio */}
        <div className="mt-4">
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-end gap-4">
                <div className="min-w-[320px]">
                  <div className="mb-2 text-xs font-extrabold text-muted-foreground">
                    Reglas por Servicio (opcional)
                  </div>

                  <select
                    value={selectedServiceId}
                    onChange={(e) => setSelectedServiceId(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white/92 px-3 text-sm font-semibold shadow-[0_8px_18px_rgba(15,23,42,0.05)]"
                    disabled={loadingServices || services.length === 0}
                  >
                    {services.length === 0 ? (
                      <option value="">
                        {loadingServices
                          ? "Cargando servicios…"
                          : "No hay servicios activos"}
                      </option>
                    ) : (
                      services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))
                    )}
                  </select>

                  <div className="mt-2 text-xs text-muted-foreground">
                    Si defines reglas aquí, <b>la disponibilidad en Reservar</b>{" "}
                    se limitará a:
                    <br />
                    <b>horario base ∩ reglas del servicio</b>.
                    <br />
                    Si no hay reglas, se usa solo el horario base.
                  </div>
                </div>

                <div className="flex-1" />

                <PrimaryButton
                  onClick={saveServiceRules}
                  disabled={
                    savingServiceRules ||
                    loadingServiceRules ||
                    !selectedProfessionalId ||
                    !selectedServiceId
                  }
                >
                  {savingServiceRules
                    ? "Guardando…"
                    : "Guardar reglas (servicio)"}
                </PrimaryButton>
              </div>

              {serviceRulesError ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {serviceRulesError}
                </div>
              ) : null}

              <div className="mt-3 text-sm font-extrabold">
                Horarios para:{" "}
                <span className="font-black">
                  {selectedService?.name ?? "(selecciona un servicio)"}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Crea bloques SOLO en los horarios que quieras permitir para este
                servicio.
                <br />
                (Click a un bloque para quitarlo).
              </div>

              <div className="mt-3">
                <WeeklyAvailabilityCalendar
                  key={`svc:${selectedProfessionalId}:${selectedServiceId}:${weekKey(viewDate)}`}
                  weekDate={viewDate}
                  blocks={serviceRulesBlocks}
                  timeZone={UI_CONFIG.ADMIN_TIMEZONE}
                  onChangeBlocks={(next) => setServiceRulesBlocks(next)}
                  slotMinTime={UI_CONFIG.SLOT_MIN_TIME}
                  slotMaxTime={UI_CONFIG.SLOT_MAX_TIME}
                />
              </div>

              {loadingServiceRules ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  Cargando reglas…
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>

        {/* Calendario de Citas */}
        <div className="mt-4">
          <Card>
            <CardBody>
              <div className="overflow-x-auto">
                <div className="min-w-[820px]">
              <FullCalendar
                plugins={[timeGridPlugin, interactionPlugin, luxonPlugin]}
                initialView={UI_CONFIG.CALENDAR_VIEW as any}
                timeZone={UI_CONFIG.ADMIN_TIMEZONE}
                locale={esLocale}
                firstDay={1}
                selectable
                editable
                select={handleSelect}
                eventDrop={handleEventDrop}
                eventClick={handleEventClick}
                datesSet={handleDatesSet}
                events={events}
                height="auto"
                allDaySlot={false}
                slotMinTime={UI_CONFIG.SLOT_MIN_TIME}
                slotMaxTime={UI_CONFIG.SLOT_MAX_TIME}
                slotEventOverlap
                eventOrderStrict
                eventOrder={(a: any, b: any) => {
                  const aStatus =
                    typeof a.extendedProps?.status === "string"
                      ? a.extendedProps.status
                      : "confirmed";
                  const bStatus =
                    typeof b.extendedProps?.status === "string"
                      ? b.extendedProps.status
                      : "confirmed";

                  if (aStatus === bStatus) return 0;
                  if (aStatus === "canceled") return 1;
                  if (bStatus === "canceled") return -1;
                  return 0;
                }}
                headerToolbar={false}
                dayHeaderFormat={{ weekday: "short", day: "numeric" }}
                ref={calendarRef}
                eventContent={(arg) => {
                  const customerName =
                    typeof arg.event.extendedProps?.customer_name === "string"
                      ? arg.event.extendedProps.customer_name.trim()
                      : "";
                  const status =
                    typeof arg.event.extendedProps?.status === "string"
                      ? arg.event.extendedProps.status
                      : "confirmed";
                  const isCanceled = status === "canceled";
                  const displayName = customerName || "Cita";

                  const start = arg.event.start;
                  const end = arg.event.end;

                  const timeLabel =
                    start && end
                      ? `${start.toLocaleTimeString("es-CL", {
                          timeZone: UI_CONFIG.ADMIN_TIMEZONE,
                          hour: "2-digit",
                          minute: "2-digit",
                        })} - ${end.toLocaleTimeString("es-CL", {
                          timeZone: UI_CONFIG.ADMIN_TIMEZONE,
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : arg.timeText || "Cita";
                  const titleLabel = customerName
                    ? `${customerName} · ${timeLabel}`
                    : timeLabel;

                  return (
                    <div
                      className="citaya-event-content min-w-0 max-w-full"
                      title={titleLabel}
                    >
                      {isCanceled ? (
                        <div className="citaya-event-pill text-slate-700/90">
                          Cancelada
                        </div>
                      ) : (
                        <div className="citaya-event-name text-white">
                          {displayName}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Modal crear cita */}
        <AppointmentCreateModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setSlot(null);
          }}
          startISO={slot?.startISO ?? ""}
          endISO={slot?.endISO ?? ""}
          customers={customers}
          tenantId={tenantId}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
          onCreatedCustomer={(c) => {
            setCustomers((prev) => {
              if (prev.some((x) => x.id === c.id)) return prev;
              return [c, ...prev];
            });
          }}
          onConfirm={async ({ customerId, serviceId }) => {
            await createAppointmentWithCustomer({ customerId, serviceId });
          }}
        />

        {/* Modal acciones cita */}
        {actionOpen && selectedEvent && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-[560px] rounded-2xl border bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-black">
                    Acciones de la cita
                  </div>

                  {(() => {
                    const { date, startTime, endTime } = formatDateTimeRange(
                      selectedEvent.startISO,
                      selectedEvent.endISO,
                    );

                    const phoneLabel =
                      selectedEvent.customerPhone ?? "(sin teléfono)";

                    return (
                      <div className="mt-2">
                        <div className="text-sm font-extrabold">
                          {selectedEvent.title}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          📅 {date} • 🕒 {startTime} – {endTime}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {phoneLabel}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <SecondaryButton
                  onClick={() => {
                    setActionOpen(false);
                    setSelectedEvent(null);
                  }}
                >
                  Cerrar
                </SecondaryButton>
              </div>

              <div className="mt-4 grid gap-2">
                <PrimaryButton
                  onClick={() => {
                    if (!selectedEvent.customerPhone) {
                      toast({ title: "Esta cita no tiene telefono", variant: "destructive" });
                      return;
                    }
                    const p = normalizePhoneToWhatsApp(
                      selectedEvent.customerPhone,
                    );
                    window.open(`https://wa.me/${p}`, "_blank");
                  }}
                  disabled={!selectedEvent.customerPhone}
                >
                  Abrir WhatsApp
                </PrimaryButton>

                <SecondaryButton
                  onClick={() => {
                    const { date, startTime, endTime } = formatDateTimeRange(
                      selectedEvent.startISO,
                      selectedEvent.endISO,
                    );

                    const customerName =
                      selectedEvent.title.replace(/^❌\s*/, "").trim() ||
                      "cliente";

                    const msg = buildConfirmationMessage({
                      customerName,
                      dateLabel: date,
                      startTime,
                      endTime,
                      businessName:
                        tenantName || tenantSlug || UI_CONFIG.BUSINESS_NAME,
                    });

                    navigator.clipboard.writeText(msg);
                    toast({ title: "Mensaje copiado al portapapeles" });
                  }}
                >
                  Copiar mensaje confirmación
                </SecondaryButton>

                <SecondaryButton
                  onClick={async () => {
                    const ok = confirm("¿Cancelar esta cita?");
                    if (!ok) return;

                    await cancelAppointment(selectedEvent.id);

                    setActionOpen(false);
                    setSelectedEvent(null);
                  }}
                >
                  Cancelar cita
                </SecondaryButton>
              </div>

              <div className="mt-3 text-xs text-muted-foreground">
                Tip: WhatsApp abre en una pestaña nueva. El mensaje usa el
                nombre desde <b>UI_CONFIG.BUSINESS_NAME</b>.
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
