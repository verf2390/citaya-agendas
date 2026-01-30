"use client";

/**
 * =====================================================
 * ADMIN AGENDA — UI SaaS Clean (MULTI-TENANT)
 * =====================================================
 *
 * 👉 ZONAS DE MANTENCIÓN / CONFIGURACIÓN RÁPIDA
 * -----------------------------------------------------
 * - Horario visible del calendario
 * - Mensajes / textos
 * - Estilo visual
 *
 * ⚠️ NO TOCAR:
 * - Resolución tenant
 * - Auth
 * - Queries Supabase
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { toast } from "@/components/ui/use-toast";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import type {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  DatesSetArg,
} from "@fullcalendar/core";

import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import { normalizePhoneToWhatsApp } from "@/app/lib/phone";

import AdminAgendaHeader from "@/components/admin/AdminAgendaHeader";

import AppointmentCreateModal, {
  CustomerLite,
} from "./components/AppointmentCreateModal";

/* =====================================================
   CONFIGURACIÓN RÁPIDA (MANTENCIÓN / SERVICIO)
   👉 puedes modificar sin romper lógica
===================================================== */

const UI_CONFIG = {
  SLOT_MIN_TIME: "07:00:00", // ⏰ inicio día visible
  SLOT_MAX_TIME: "21:00:00", // ⏰ fin día visible
  CALENDAR_VIEW: "timeGridWeek", // timeGridDay | timeGridWeek
  BUSINESS_NAME: "Citaya", // usado en mensajes
};

/* =====================================================
   TIPOS
===================================================== */

type AppointmentStatus = "confirmed" | "completed" | "canceled" | "no_show";

type Appointment = {
  id: string;
  tenant_id: string;
  professional_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_id?: string | null;
  start_at: string;
  end_at: string;
  status?: AppointmentStatus | null;
  customers?: { full_name: string | null; phone: string | null }[] | null;
};

type Professional = {
  id: string;
  name: string | null;
  tenant_id: string;
};

type AvailabilityRow = {
  professional_id: string;
  day_of_week: number; // 0 = domingo
  start_time: string;
  end_time: string;
  is_active: boolean;
};

type AvailabilityMap = Record<string, Record<number, AvailabilityRow[]>>;

type BgEvent = {
  id: string;
  start: string;
  end: string;
  display: "background";
  classNames: string[];
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  classNames?: string[];
  extendedProps: {
    professional_id: string;
    customer_phone: string | null;
    status: AppointmentStatus;
    customer_id: string | null;
  };
};

type CustomerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
};

/* =====================================================
   HELPERS (NO TOCAR)
===================================================== */

// ✅ OJO: useState NO puede ir aquí. Se moverá dentro del componente AgendaPage.

const timeToMinutes = (time: string) => {
  const [hh, mm] = time.split(":").map(Number);
  return hh * 60 + mm;
};

const dateToMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

const isWithinAvailability = ({
  startMin,
  endMin,
  blocks,
}: {
  startMin: number;
  endMin: number;
  blocks: AvailabilityRow[];
}) =>
  blocks.some((b) => {
    const bs = timeToMinutes(b.start_time);
    const be = timeToMinutes(b.end_time);
    return startMin >= bs && endMin <= be;
  });

const setTimeOnDate = (date: Date, time: string) => {
  const [hh, mm] = time.split(":").map(Number);
  const d = new Date(date);
  d.setHours(hh, mm, 0, 0);
  return d;
};
/* =====================================================
   BACKGROUND: NO DISPONIBLE (generación de bloques)
===================================================== */

function buildUnavailableBgEvents(params: {
  rangeStartISO: string;
  rangeEndISO: string;
  blocks: { day_of_week: number; start_time: string; end_time: string }[];
  slotMinTime: string;
  slotMaxTime: string;
}) {
  const { rangeStartISO, rangeEndISO, blocks, slotMinTime, slotMaxTime } =
    params;

  const rangeStart = new Date(rangeStartISO);
  const rangeEnd = new Date(rangeEndISO);

  const results: BgEvent[] = [];

  for (let d = new Date(rangeStart); d < rangeEnd; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();

    const dayBlocks = blocks
      .filter((b) => b.day_of_week === dayOfWeek)
      .slice()
      .sort((a, b) => (a.start_time > b.start_time ? 1 : -1));

    const dayStart = setTimeOnDate(d, slotMinTime);
    const dayEnd = setTimeOnDate(d, slotMaxTime);

    if (dayBlocks.length === 0) {
      results.push({
        id: `bg-${d.toISOString()}-full`,
        start: dayStart.toISOString(),
        end: dayEnd.toISOString(),
        display: "background",
        classNames: ["fc-bg-unavailable"],
      });
      continue;
    }

    let cursor = dayStart;

    for (const b of dayBlocks) {
      const blockStart = setTimeOnDate(d, b.start_time);
      const blockEnd = setTimeOnDate(d, b.end_time);

      if (cursor < blockStart) {
        results.push({
          id: `bg-${d.toISOString()}-${cursor.toISOString()}`,
          start: cursor.toISOString(),
          end: blockStart.toISOString(),
          display: "background",
          classNames: ["fc-bg-unavailable"],
        });
      }

      cursor = blockEnd;
    }

    if (cursor < dayEnd) {
      results.push({
        id: `bg-${d.toISOString()}-end`,
        start: cursor.toISOString(),
        end: dayEnd.toISOString(),
        display: "background",
        classNames: ["fc-bg-unavailable"],
      });
    }
  }

  return results;
}

function formatDateTimeRange(startISO: string, endISO: string) {
  const start = new Date(startISO);
  const end = new Date(endISO);

  const date = start.toLocaleDateString("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const startTime = start.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const endTime = end.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return { date, startTime, endTime };
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

/* =====================================================
   UI: pequeños componentes inline (sin dependencias)
   (para que el archivo sea 1 sola pieza)
===================================================== */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: "white",
        fontSize: 12,
        fontWeight: 650,
        color: "#111827",
      }}
    >
      {children}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        background: "white",
        borderRadius: 16,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </div>
  );
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 14 }}>{children}</div>;
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
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        background: "white",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 650,
        color: "#111",
      }}
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
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid #111827",
        background: "#111827",
        color: "white",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontSize: 14,
        fontWeight: 650,
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({
  title,
  desc,
  action,
}: {
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div style={{ fontWeight: 850, fontSize: 16 }}>{title}</div>
        <div
          style={{ marginTop: 6, fontSize: 13, opacity: 0.78, lineHeight: 1.5 }}
        >
          {desc}
        </div>
        {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
      </CardBody>
    </Card>
  );
}
/* =====================================================
   PAGE
===================================================== */

export default function AgendaPage() {
  const router = useRouter();

  // ✅ FIX: hooks SIEMPRE dentro del componente
  const [viewDate, setViewDate] = useState<Date>(new Date());

  // Tenant
  const [tenantId, setTenantId] = useState<string>("");
  const [tenantSlug, setTenantSlug] = useState<string>("");
  const [tenantError, setTenantError] = useState<string>("");
  const [loadingTenant, setLoadingTenant] = useState(true);
  const [tenantLogoUrl, setTenantLogoUrl] = useState<string>("");

  // Auth
  const [authChecked, setAuthChecked] = useState(false);

  // Calendar data
  const [bgEvents, setBgEvents] = useState<BgEvent[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const calendarRef = useRef<FullCalendar | null>(null);

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedProfessionalId, setSelectedProfessionalId] =
    useState<string>("");

  const [availabilityMap, setAvailabilityMap] = useState<AvailabilityMap>({});
  const [visibleRange, setVisibleRange] = useState<{
    start: string;
    end: string;
  } | null>(null);

  const [customers, setCustomers] = useState<CustomerLite[]>([]);

  // Modals
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

  const selectedProfessional = useMemo(() => {
    return professionals.find((p) => p.id === selectedProfessionalId) ?? null;
  }, [professionals, selectedProfessionalId]);

  const noProfessionals = professionals.length === 0;
  const proName = selectedProfessional?.name ?? "(sin nombre)";

  // ✅ Demo/Soporte: mostrar cosas "debug" solo con ?debug=1
  const isDebug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";

  /* =====================================================
     HOOKS (todos arriba, sin returns antes)
     ⚠️ No moverlos de orden para evitar error React (#310)
  ===================================================== */

  // 1) Resolver tenant
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
        .select("id, slug, logo_url")
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
      setLoadingTenant(false);
    };

    run();
  }, []);

  // 2) Validar sesión (cuando tenant esté resuelto y sea válido)
  useEffect(() => {
    const run = async () => {
      if (loadingTenant) return;
      if (tenantError) return;
      if (!tenantId) return;

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const redirectTo = `${window.location.pathname}${
          window.location.search || ""
        }`;
        router.push(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
        return;
      }

      setAuthChecked(true);
    };

    run();
  }, [router, loadingTenant, tenantError, tenantId]);

  /* =====================================================
     LOADERS (no hooks)
  ===================================================== */

  const loadCustomers = async () => {
    const { data, error } = await supabase
      .from("customers")
      .select("id, full_name, phone, email")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true })
      .limit(500);

    if (error) {
      console.error("Error loading customers:", error);
      return;
    }

    const rows = (data as CustomerRow[] | null) ?? [];
    const list: CustomerLite[] = rows.map((c) => ({
      id: c.id,
      name: c.full_name,
      phone: c.phone ?? null,
      email: c.email ?? null,
    }));

    setCustomers(list);
  };

  const loadProfessionals = async () => {
    const { data, error } = await supabase
      .from("professionals")
      .select("id, name, tenant_id")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });

    if (error) {
      console.error("Error loading professionals:", error);
      return;
    }

    const list = (data as Professional[] | null) ?? [];
    setProfessionals(list);

    // Si no hay seleccionado, elige el primero
    setSelectedProfessionalId((prev) => prev || (list[0]?.id ?? ""));
  };

  const loadAvailability = async () => {
    const { data, error } = await supabase
      .from("availability")
      .select("professional_id, day_of_week, start_time, end_time, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    if (error) {
      console.error("Error cargando availability:", error);
      setAvailabilityMap({});
      return;
    }

    const map: AvailabilityMap = {};
    ((data as AvailabilityRow[] | null) ?? []).forEach((a) => {
      if (!map[a.professional_id]) map[a.professional_id] = {};
      if (!map[a.professional_id][a.day_of_week])
        map[a.professional_id][a.day_of_week] = [];
      map[a.professional_id][a.day_of_week].push(a);
    });

    setAvailabilityMap(map);
  };

  const loadAppointments = async (
    start?: string,
    end?: string,
    professionalId?: string,
  ) => {
    setLoading(true);

    let q = supabase
      .from("appointments")
      .select(
        `
          id,
          tenant_id,
          professional_id,
          customer_id,
          customer_name,
          customer_phone,
          start_at,
          end_at,
          status
       `,
      )
      .eq("tenant_id", tenantId)
      .order("start_at", { ascending: true });

    if (professionalId) q = q.eq("professional_id", professionalId);
    if (start && end) q = q.gte("start_at", start).lt("start_at", end);

    const { data, error } = await q;

    if (error) {
      console.error("Error loading appointments:", error);
      setLoading(false);
      return;
    }

    const mapped: CalendarEvent[] = ((data as Appointment[] | null) ?? []).map(
      (a) => {
        const titleBase = a.customer_name ?? "Cita";
        const status = (a.status ?? "confirmed") as AppointmentStatus;

        const classNames = ["citaya-event", `citaya-status-${status}`];

        return {
          id: a.id,
          title: status === "canceled" ? `❌ ${titleBase}` : titleBase,
          start: a.start_at,
          end: a.end_at,
          classNames,
          extendedProps: {
            professional_id: a.professional_id,
            customer_phone: a.customer_phone,
            status,
            customer_id: a.customer_id ?? null,
          },
        };
      },
    );

    setEvents(mapped);
    setLoading(false);
  };

  // 3) Cargar base data cuando auth OK
  useEffect(() => {
    if (!authChecked) return;
    if (!tenantId) return;

    loadProfessionals();
    loadAvailability();
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, tenantId]);

  // 4) Background de NO disponible
  useEffect(() => {
    if (!authChecked) return;
    if (!selectedProfessionalId) return;
    if (!visibleRange) return;

    const blocksForPro: AvailabilityRow[] = [];
    const proMap = availabilityMap[selectedProfessionalId] ?? {};
    Object.keys(proMap).forEach((dayKey) => {
      const day = Number(dayKey);
      (proMap[day] ?? []).forEach((b) => blocksForPro.push(b));
    });

    const bg = buildUnavailableBgEvents({
      rangeStartISO: visibleRange.start,
      rangeEndISO: visibleRange.end,
      blocks: blocksForPro,
      slotMinTime: UI_CONFIG.SLOT_MIN_TIME,
      slotMaxTime: UI_CONFIG.SLOT_MAX_TIME,
    });

    setBgEvents(bg);
  }, [authChecked, selectedProfessionalId, visibleRange, availabilityMap]);

  // 5) Recargar citas cuando cambie profesional o rango
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authChecked,
    tenantId,
    selectedProfessionalId,
    visibleRange?.start,
    visibleRange?.end,
  ]);

  /* =====================================================
     HANDLERS
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
      .neq("status", "canceled")
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
      alert("Selecciona un profesional primero");
      return;
    }

    const startDate = selectInfo.start;
    const endDate = selectInfo.end;

    const start_at = startDate.toISOString();
    const end_at = endDate.toISOString();

    const dayOfWeek = startDate.getDay();
    const startMin = dateToMinutes(startDate);
    const endMin = dateToMinutes(endDate);

    const blocks = availabilityMap[selectedProfessionalId]?.[dayOfWeek] ?? [];
    if (!isWithinAvailability({ startMin, endMin, blocks })) {
      alert("❌ Fuera de disponibilidad del profesional");
      return;
    }

    const overlap = await hasOverlap(start_at, end_at, selectedProfessionalId);
    if (overlap) {
      alert("❌ Ya existe una cita en ese horario (no se permiten traslapes).");
      return;
    }

    setSlot({ startISO: start_at, endISO: end_at });
    setCreateOpen(true);
  };

  async function createAppointmentViaApi(payload: {
    tenant_id: string;
    professional_id: string;
    customer_name: string;
    customer_phone: string | null;
    customer_email: string;
    start_at: string;
    end_at: string;
  }) {
    const res = await fetch("/api/appointments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? "Error creando cita");
    return json;
  }

  async function createAppointmentWithCustomer(customerId: string) {
    if (!slot) return;

    const customer = customers.find((c) => c.id === customerId) ?? null;

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

      await createAppointmentViaApi({
        tenant_id: tenantId,
        professional_id: selectedProfessionalId,
        customer_name: customer?.name ?? "Cliente",
        customer_phone: customer?.phone ?? null,
        customer_email,
        start_at: slot.startISO,
        end_at: slot.endISO,
      });
      toast({
        title: "Cita creada",
        description: "Se guardó correctamente.",
      });
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

    const start_at = startDate.toISOString();
    const end_at = endDate.toISOString();

    // ✅ Validación de disponibilidad
    const dayOfWeek = startDate.getDay();
    const startMin = dateToMinutes(startDate);
    const endMin = dateToMinutes(endDate);

    const blocks = availabilityMap[selectedProfessionalId]?.[dayOfWeek] ?? [];
    if (!isWithinAvailability({ startMin, endMin, blocks })) {
      toast({
        title: "Movimiento no permitido",
        description: "Fuera de disponibilidad del profesional.",
        variant: "destructive",
      });
      dropInfo.revert();
      return;
    }

    // ✅ Validación de traslape
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

    // ✅ Backend: actualiza + llama n8n
    try {
      const res = await fetch("/api/appointments/reschedule-by-id", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appointment_id: id,
          new_start_at: start_at,
          new_end_at: end_at,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        toast({
          title: "No se pudo reagendar",
          description: "El servidor rechazó el cambio. Se revirtió.",
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

    // refrescar
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
        body: JSON.stringify({ appointment_id: appointmentId }),
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
      // ✅ TOAST DE ÉXITO (AQUÍ)
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

  const handleDatesSet = async (arg: DatesSetArg) => {
    const start = arg.startStr;
    const end = arg.endStr;

    // ✅ además mantenemos el estado "viewDate" para el header
    setViewDate(arg.start);

    setVisibleRange({ start, end });

    if (!selectedProfessionalId) return;
    await loadAppointments(start, end, selectedProfessionalId);
  };

  /* =====================================================
     RENDER (un solo return al final)
  ===================================================== */

  // Pantallas de estado (UI pro, pero simples)
  if (tenantError) {
    return (
      <main style={{ minHeight: "100vh", background: "#f6f7fb" }}>
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: 22,
            fontFamily: "system-ui",
          }}
        >
          <div style={{ paddingTop: 18 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>⚠️ Acceso inválido</h1>
            <div style={{ marginTop: 10 }}>
              <EmptyState
                title="No se puede abrir este panel"
                desc={tenantError}
                action={
                  <Link
                    href="https://app.citaya.online"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      background: "white",
                      textDecoration: "none",
                      color: "#111",
                      fontSize: 14,
                      fontWeight: 650,
                    }}
                  >
                    Ir al dominio principal
                  </Link>
                }
              />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (loadingTenant) {
    return (
      <main style={{ minHeight: "100vh", background: "#f6f7fb" }}>
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: 22,
            fontFamily: "system-ui",
          }}
        >
          <Card>
            <CardBody>
              <div style={{ fontWeight: 850, fontSize: 16 }}>
                Cargando panel…
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  opacity: 0.75,
                  lineHeight: 1.5,
                }}
              >
                Resolviendo cliente (subdominio)…
              </div>
              <div
                style={{
                  marginTop: 12,
                  height: 8,
                  borderRadius: 999,
                  background: "#eef0f5",
                }}
              />
            </CardBody>
          </Card>
        </div>
      </main>
    );
  }

  if (!tenantId) {
    return (
      <main style={{ minHeight: "100vh", background: "#f6f7fb" }}>
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: 22,
            fontFamily: "system-ui",
          }}
        >
          <Card>
            <CardBody>
              <div style={{ fontWeight: 850, fontSize: 16 }}>
                Cargando panel…
              </div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
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
      <main style={{ minHeight: "100vh", background: "#f6f7fb" }}>
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: 22,
            fontFamily: "system-ui",
          }}
        >
          <Card>
            <CardBody>
              <div style={{ fontWeight: 850, fontSize: 16 }}>
                Validando sesión…
              </div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
                Si no estás autenticado, te redirigiremos a Login.
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    );
  }

  // Empty state: sin profesionales
  if (noProfessionals) {
    return (
      <main style={{ minHeight: "100vh", background: "#f6f7fb" }}>
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: 22,
            fontFamily: "system-ui",
          }}
        >
          <EmptyState
            title="Aún no hay profesionales"
            desc="Para usar la agenda, primero debes crear al menos 1 profesional para este cliente. Luego podrás agendar, mover y gestionar citas."
            action={
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href="/admin/customers"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "white",
                    textDecoration: "none",
                    color: "#111",
                    fontSize: 14,
                    fontWeight: 650,
                  }}
                >
                  Ir a Clientes
                </Link>
                <SecondaryButton onClick={onLogout}>
                  Cerrar sesión
                </SecondaryButton>
                <SecondaryButton onClick={() => location.reload()}>
                  Actualizar
                </SecondaryButton>
              </div>
            }
          />
        </div>
      </main>
    );
  }

  // Si hay eventos pero el calendario está cargando, mostramos un hint arriba
  const showLoadingHint = loading;

  // 👇 PARTE 4 continúa desde aquí (return principal)
  return (
    <main style={{ minHeight: "100vh", background: "#f6f7fb" }}>
      <style>{`
      /* ZONA DE MANTENCIÓN (estética fullcalendar) */
      .fc { font-family: system-ui; }
      .fc .fc-toolbar-title { font-size: 16px; font-weight: 800; }
      .fc-bg-unavailable { background: rgba(17, 24, 39, 0.07); }
      .fc .fc-timegrid-slot-label { font-size: 12px; opacity: 0.75; }
      .fc .fc-timegrid-axis-cushion { font-size: 12px; opacity: 0.75; }
      .fc .fc-col-header-cell-cushion { font-size: 12px; font-weight: 800; color: #111827; }
      .fc .fc-event {
        border-radius: 10px;
        border: 1px solid rgba(0,0,0,0.08);
        padding: 2px;
      }

      /* =========================
          Colores por estado cita
      ========================= */

      .citaya-event .fc-event-main { font-weight: 650; }

      /* Confirmada (azul) */
      .citaya-status-confirmed {
        border-color: #2563eb !important;
        background: #3b82f6 !important;
      }

      /* Cancelada (gris) */
      .citaya-status-canceled {
        border-color: #9ca3af !important;
        background: #9ca3af !important;
        opacity: 0.85;
      }

      /* Completada (verde) */
      .citaya-status-completed {
        border-color: #16a34a !important;
        background: #22c55e !important;
      }

      /* No show (rojo suave) */
      .citaya-status-no_show {
        border-color: #ef4444 !important;
        background: #f87171 !important;
      }
    `}</style>

      {/* TODO: aquí sigue TODO tu contenido actual tal cual:
        <AdminAgendaHeader ... />
        <div ...> ... */}

      <AdminAgendaHeader
        tenantName={tenantSlug}
        tenantLogoUrl={tenantLogoUrl}
        date={viewDate}
        onToday={() => calendarRef.current?.getApi()?.today()}
        onPrevDay={() => calendarRef.current?.getApi()?.prev()}
        onNextDay={() => calendarRef.current?.getApi()?.next()}
        onNewAppointment={() => {
          // Mantengo tu ruta actual para no romper nada
          router.push("/admin/customers/new");
        }}
        rightSlot={
          <>
            <Link
              href="/admin/customers"
              className="h-8 rounded-md border bg-white px-3 text-sm font-medium hover:bg-muted"
            >
              Clientes
            </Link>

            <button
              type="button"
              onClick={onLogout}
              className="h-8 rounded-md border bg-white px-3 text-sm font-medium hover:bg-muted"
            >
              Cerrar sesión
            </button>
          </>
        }
        subSlot={
          <>
            <Badge>Cliente: {tenantSlug}</Badge>
            <Badge>Profesional: {proName}</Badge>
            <Badge>
              Ventana: {UI_CONFIG.SLOT_MIN_TIME.slice(0, 5)}–
              {UI_CONFIG.SLOT_MAX_TIME.slice(0, 5)}
            </Badge>
            <Badge>Vista: Semana</Badge>
            {isDebug ? <Badge>Tenant ID: {tenantId}</Badge> : null}
            {showLoadingHint ? <Badge>Cargando citas…</Badge> : null}
          </>
        }
      />

      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: 14,
          fontFamily: "system-ui",
        }}
      >
        {/* Controls */}
        <div style={{ marginTop: 14 }}>
          <Card>
            <CardBody>
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "end",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 280 }}>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      marginBottom: 6,
                      fontWeight: 750,
                    }}
                  >
                    Profesional
                  </div>

                  <select
                    value={selectedProfessionalId}
                    onChange={(e) => setSelectedProfessionalId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      background: "white",
                      fontSize: 14,
                      fontWeight: 650,
                    }}
                  >
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name ?? "(sin nombre)"}
                      </option>
                    ))}
                  </select>

                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      opacity: 0.7,
                      lineHeight: 1.35,
                    }}
                  >
                    Tip: Selecciona un rango para crear • arrastra para
                    reprogramar • click para acciones
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Calendar */}
        <div style={{ marginTop: 14 }}>
          <Card>
            <CardBody>
              <FullCalendar
                plugins={[timeGridPlugin, interactionPlugin]}
                initialView={UI_CONFIG.CALENDAR_VIEW as any}
                timeZone="local"
                locale={esLocale}
                selectable
                editable
                select={handleSelect}
                eventDrop={handleEventDrop}
                eventClick={handleEventClick}
                datesSet={handleDatesSet}
                events={[...bgEvents, ...events]}
                height="auto"
                allDaySlot={false}
                slotMinTime={UI_CONFIG.SLOT_MIN_TIME}
                slotMaxTime={UI_CONFIG.SLOT_MAX_TIME}
                headerToolbar={false}
                dayHeaderFormat={{ weekday: "short", day: "numeric" }}
                ref={calendarRef}
              />

              {/* Empty state citas (solo visual) */}
              {!loading && events.length === 0 ? (
                <div style={{ marginTop: 12 }}>
                  <EmptyState
                    title="No hay citas en este rango"
                    desc="Prueba seleccionando un rango en el calendario para crear una cita. También puedes cambiar el profesional."
                    action={
                      <SecondaryButton onClick={() => location.reload()}>
                        Actualizar
                      </SecondaryButton>
                    }
                  />
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>

        {/* Create Modal */}
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
          onCreatedCustomer={(c) => {
            setCustomers((prev) => {
              if (prev.some((x) => x.id === c.id)) return prev;
              return [c, ...prev];
            });
          }}
          onConfirm={async ({ customerId }) => {
            await createAppointmentWithCustomer(customerId);
          }}
        />

        {/* Actions Modal */}
        {actionOpen && selectedEvent && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(17,24,39,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              zIndex: 60,
            }}
          >
            <div
              style={{
                width: "min(560px, 100%)",
                background: "white",
                borderRadius: 18,
                border: "1px solid #e5e7eb",
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ fontWeight: 950, fontSize: 16 }}>
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
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 850 }}>
                          {selectedEvent.title}
                        </div>
                        <div
                          style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}
                        >
                          📅 {date} • 🕒 {startTime} – {endTime}
                        </div>
                        <div
                          style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}
                        >
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

              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                <PrimaryButton
                  onClick={() => {
                    if (!selectedEvent.customerPhone) {
                      alert("Esta cita no tiene teléfono.");
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
                      businessName: UI_CONFIG.BUSINESS_NAME,
                    });

                    navigator.clipboard.writeText(msg);
                    alert("✅ Mensaje copiado al portapapeles");
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

              <div
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  opacity: 0.65,
                  lineHeight: 1.4,
                }}
              >
                Tip: WhatsApp abre en una pestaña nueva. El mensaje de
                confirmación usa el nombre del negocio desde{" "}
                <b>UI_CONFIG.BUSINESS_NAME</b>.
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
