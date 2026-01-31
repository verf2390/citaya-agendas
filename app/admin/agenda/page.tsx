"use client";

/**
 * =====================================================
 * ADMIN AGENDA — MULTI-TENANT (subdominio)
 * =====================================================
 * - Calendario de CITAS (FullCalendar)
 * - Editor de HORARIOS semanal (WeeklyAvailabilityCalendar)
 * - Professionals via API server-side (filtrado por tenant)
 * - Availability via API server-side
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
import { toast } from "@/components/ui/use-toast";
import { normalizePhoneToWhatsApp } from "@/app/lib/phone";

import AdminAgendaHeader from "@/components/admin/AdminAgendaHeader";
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
};

/* =====================================================
   TYPES
===================================================== */

type AppointmentStatus = "confirmed" | "completed" | "canceled" | "no_show";

type Appointment = {
  id: string;
  tenant_id: string;
  professional_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  start_at: string;
  end_at: string;
  status: AppointmentStatus | null;
};

type Professional = {
  id: string;
  name: string | null;
  tenant_id: string;
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

type AvailabilityBlock = {
  id?: string; // si viene de DB
  tempId?: string; // si es nuevo (calendar editor)
  day_of_week: number; // 0-6
  start_time: string; // "HH:MM" o "HH:MM:SS"
  end_time: string; // "HH:MM" o "HH:MM:SS"
  is_active: boolean;
};

/* =====================================================
   HELPERS
===================================================== */

const dateToMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

const timeToMinutes = (time: string) => {
  const t = time?.slice(0, 5) || "00:00";
  const [hh, mm] = t.split(":").map(Number);
  return hh * 60 + mm;
};

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

  const [viewDate, setViewDate] = useState<Date>(new Date());

  // tenant
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [loadingTenant, setLoadingTenant] = useState(true);
  const [tenantLogoUrl, setTenantLogoUrl] = useState("");

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

  // customers (para modal)
  const [customers, setCustomers] = useState<CustomerLite[]>([]);

  // availability (editor)
  const [availabilityBlocks, setAvailabilityBlocks] = useState<
    AvailabilityBlock[]
  >([]);
  const [savingAvailability, setSavingAvailability] = useState(false);

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

  /* =====================================================
     LOADERS
  ===================================================== */

  const loadProfessionals = async () => {
    try {
      // ✅ IMPORTANTE: pasar tenantId para que el endpoint devuelva SOLO los pros del tenant actual
      const res = await fetch(
        `/api/admin/professionals/list?tenantId=${encodeURIComponent(tenantId)}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Error loading professionals (API):", json);
        setProfessionals([]);
        setSelectedProfessionalId("");
        return;
      }

      const list = (json?.professionals ?? []) as Professional[];

      // ✅ doble seguridad: filtramos local por tenant
      const tenantPros = list.filter((p) => p.tenant_id === tenantId);

      setProfessionals(tenantPros);

      setSelectedProfessionalId((prev) => {
        const exists = tenantPros.some((p) => p.id === prev);
        if (exists) return prev;
        return tenantPros[0]?.id ?? "";
      });
    } catch (e) {
      console.error("Error loading professionals:", e);
      setProfessionals([]);
      setSelectedProfessionalId("");
    }
  };

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

  const loadAvailability = async (professionalId: string) => {
    try {
      // ✅ Pasamos tenantId como “context” (si tu endpoint lo usa). Si no lo usa, no rompe.
      const res = await fetch(
        `/api/admin/availability/list?tenantId=${encodeURIComponent(tenantId)}&professionalId=${encodeURIComponent(
          professionalId,
        )}`,
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

      // normalizamos a HH:MM
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
  };

  const saveAvailability = async () => {
    if (!selectedProfessionalId) return;

    setSavingAvailability(true);
    try {
      const payload = {
        tenantId, // ✅ para backends que validan tenant
        professionalId: selectedProfessionalId,
        items: availabilityBlocks.map((b) => ({
          id: b.id ?? null,
          day_of_week: b.day_of_week,
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
      if (!res.ok) {
        throw new Error(json?.error ?? "No se pudo guardar disponibilidad");
      }

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

  const loadAppointments = async (
    start?: string,
    end?: string,
    professionalId?: string,
  ) => {
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
        },
      );

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Error loading appointments (API):", json);
        setEvents([]);
        return;
      }

      const mapped: CalendarEvent[] = (json?.items ?? []).map((a: any) => {
        const titleBase = a.customer_name ?? "Cita";
        const status = (a.status ?? "confirmed") as AppointmentStatus;

        return {
          id: a.id,
          title: status === "canceled" ? `❌ ${titleBase}` : titleBase,
          start: a.start_at,
          end: a.end_at,
          classNames: ["citaya-event", `citaya-status-${status}`],
          extendedProps: {
            professional_id: a.professional_id,
            customer_phone: a.customer_phone ?? null,
            status,
            customer_id: a.customer_id ?? null,
          },
        };
      });

      setEvents(mapped);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    if (!tenantId) return;

    loadProfessionals();
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, tenantId]);

  useEffect(() => {
    if (!authChecked) return;
    if (!tenantId) return;
    if (!selectedProfessionalId) return;

    loadAvailability(selectedProfessionalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, tenantId, selectedProfessionalId]);

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

    const blocks = availabilityBlocks.filter(
      (b) => b.is_active && b.day_of_week === dayOfWeek,
    );

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

    const start_at = startDate.toISOString();
    const end_at = endDate.toISOString();

    const dayOfWeek = startDate.getDay();
    const startMin = dateToMinutes(startDate);
    const endMin = dateToMinutes(endDate);

    const blocks = availabilityBlocks.filter(
      (b) => b.is_active && b.day_of_week === dayOfWeek,
    );
    if (!isWithinAvailability({ startMin, endMin, blocks })) {
      toast({
        title: "Movimiento no permitido",
        description: "Fuera de disponibilidad del profesional.",
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

  const handleDatesSet = async (arg: DatesSetArg) => {
    setViewDate(arg.start);
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
    <main className="min-h-screen bg-[#f6f7fb]">
      <style>{`
        .fc { font-family: system-ui; }
        .fc .fc-toolbar-title { font-size: 16px; font-weight: 800; }
        .fc .fc-timegrid-slot-label { font-size: 12px; opacity: 0.75; }
        .fc .fc-timegrid-axis-cushion { font-size: 12px; opacity: 0.75; }
        .fc .fc-col-header-cell-cushion { font-size: 12px; font-weight: 800; color: #111827; }
        .fc .fc-event { border-radius: 10px; border: 1px solid rgba(0,0,0,0.08); padding: 2px; }
        .citaya-event .fc-event-main { font-weight: 650; }
        .citaya-status-confirmed { border-color: #2563eb !important; background: #3b82f6 !important; }
        .citaya-status-canceled { border-color: #9ca3af !important; background: #9ca3af !important; opacity: 0.85; }
        .citaya-status-completed { border-color: #16a34a !important; background: #22c55e !important; }
        .citaya-status-no_show { border-color: #ef4444 !important; background: #f87171 !important; }
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
            <Badge>Vista: Semana</Badge>
            {isDebug ? <Badge>Tenant ID: {tenantId}</Badge> : null}
            {isDebug ? (
              <Badge>Pro ID: {selectedProfessionalId || "—"}</Badge>
            ) : null}
            {loading ? <Badge>Cargando citas…</Badge> : null}
            {isDebug ? <Badge>Eventos: {events.length}</Badge> : null}
          </>
        }
      />

      <div className="mx-auto max-w-[1280px] p-4">
        {/* Selector profesional + Horarios */}
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
                    className="h-10 w-full rounded-xl border bg-white px-3 text-sm font-semibold"
                  >
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name ?? "(sin nombre)"}
                      </option>
                    ))}
                  </select>
                  {professionals.length === 0 ? (
                    <div className="mt-2 text-xs text-red-600">
                      No hay profesionales para este tenant ({tenantSlug}).
                      Revisa /api/admin/professionals/list.
                    </div>
                  ) : null}
                </div>

                <div className="flex-1" />

                <PrimaryButton
                  onClick={saveAvailability}
                  disabled={savingAvailability || !selectedProfessionalId}
                >
                  {savingAvailability ? "Guardando…" : "Guardar horarios"}
                </PrimaryButton>
              </div>

              <div className="mt-3 text-sm font-extrabold">
                Horarios (vista semanal)
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Crea bloques arrastrando. Mueve y ajusta con drag/resize.
              </div>

              <div className="mt-3">
                <WeeklyAvailabilityCalendar
                  weekDate={viewDate}
                  blocks={availabilityBlocks}
                  onWeekChange={(d) => setViewDate(d)}
                  onChangeBlocks={(next) => setAvailabilityBlocks(next)}
                  slotMinTime={UI_CONFIG.SLOT_MIN_TIME}
                  slotMaxTime={UI_CONFIG.SLOT_MAX_TIME}
                />
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Calendario de Citas */}
        <div className="mt-4">
          <Card>
            <CardBody>
              <FullCalendar
                plugins={[timeGridPlugin, interactionPlugin]}
                initialView={UI_CONFIG.CALENDAR_VIEW as any}
                timeZone="America/Santiago"
                locale={esLocale}
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
                headerToolbar={false}
                dayHeaderFormat={{ weekday: "short", day: "numeric" }}
                ref={calendarRef}
              />
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
