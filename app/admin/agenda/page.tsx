"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";

import type { DateSelectArg, EventClickArg, EventDropArg, DatesSetArg } from "@fullcalendar/core";

import { supabase } from "@/lib/supabaseClient";

// ✅ Modal de creación (Día 6)
import AppointmentCreateModal, { CustomerLite } from "./components/AppointmentCreateModal";

type AppointmentStatus = "confirmed" | "completed" | "canceled" | "no_show";

type Appointment = {
  id: string;
  tenant_id: string;
  professional_id: string;

  // Legacy (MVP anterior)
  customer_name: string | null;
  customer_phone: string | null;

  // Nuevo (relación)
  customer_id?: string | null;

  start_at: string;
  end_at: string;
  status?: AppointmentStatus | null;

  // ✅ Join: PostgREST a veces lo entrega como array
  customers?: { full_name: string | null; phone: string | null }[] | null;
};

type Professional = {
  id: string;
  name: string | null;
  tenant_id: string;
};

type AvailabilityRow = {
  professional_id: string;
  day_of_week: number; // 0-6 (domingo=0)
  start_time: string; // "09:00:00" o "09:00"
  end_time: string; // "18:00:00" o "18:00"
  is_active: boolean;
};

type AvailabilityMap = Record<string, Record<number, AvailabilityRow[]>>;

// ⚠️ MVP: tenant hardcodeado. Luego lo sacamos desde profiles/slug.
const TENANT_ID = "04d6c088-338d-44b2-b27b-b4709f48d31b";

/** "HH:MM:SS" o "HH:MM" -> minutos desde 00:00 */
function timeToMinutes(time: string) {
  const [hh, mm] = time.split(":").map(Number);
  return hh * 60 + mm;
}

/** Date -> minutos del día */
function dateToMinutes(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

/** True si [startMin,endMin] cabe completo dentro de al menos 1 bloque */
function isWithinAvailability(params: { startMin: number; endMin: number; blocks: AvailabilityRow[] }) {
  const { startMin, endMin, blocks } = params;
  if (!blocks || blocks.length === 0) return false;

  return blocks.some((b) => {
    const bs = timeToMinutes(b.start_time);
    const be = timeToMinutes(b.end_time);
    return startMin >= bs && endMin <= be;
  });
}

function setTimeOnDate(date: Date, timeHHMMSS: string) {
  const [hh, mm] = timeHHMMSS.split(":").map(Number);
  const d = new Date(date);
  d.setHours(hh, mm, 0, 0);
  return d;
}

// Crea eventos "background" marcando NO disponible dentro de la ventana visible.
function buildUnavailableBgEvents(params: {
  rangeStartISO: string;
  rangeEndISO: string;
  blocks: { day_of_week: number; start_time: string; end_time: string }[];
  slotMinTime: string;
  slotMaxTime: string;
}) {
  const { rangeStartISO, rangeEndISO, blocks, slotMinTime, slotMaxTime } = params;

  const rangeStart = new Date(rangeStartISO);
  const rangeEnd = new Date(rangeEndISO);

  const results: any[] = [];

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

// ✅ Helpers WhatsApp / Mensaje (PRO)
function normalizePhoneToWhatsApp(raw: string) {
  let p = raw.replace(/\D/g, "");
  // si viene como 9XXXXXXXX => 569XXXXXXXX
  if (p.length === 9 && p.startsWith("9")) p = "56" + p;
  return p;
}

function formatDateTimeRange(startISO: string, endISO: string) {
  const start = new Date(startISO);
  const end = new Date(endISO);

  const date = start.toLocaleDateString("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const startTime = start.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });

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

  const header = businessName ? `Hola ${customerName} 👋\nSoy ${businessName}.` : `Hola ${customerName} 👋`;
  return `${header}\n\n✅ Tu cita quedó agendada para:\n📅 ${dateLabel}\n🕒 ${startTime} – ${endTime}\n\nSi necesitas reprogramar, responde este mensaje.`;
}

export default function AgendaPage() {
  const router = useRouter();

  const [bgEvents, setBgEvents] = useState<any[]>([]);
  const [authChecked, setAuthChecked] = useState(false);

  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string>("");

  const [availabilityMap, setAvailabilityMap] = useState<AvailabilityMap>({});
  const [visibleRange, setVisibleRange] = useState<{ start: string; end: string } | null>(null);

  // ✅ Clientes para el modal
  const [customers, setCustomers] = useState<CustomerLite[]>([]);

  // ✅ Estado del modal de creación
  const [createOpen, setCreateOpen] = useState(false);
  const [slot, setSlot] = useState<{ startISO: string; endISO: string } | null>(null);

  // ✅ Modal de acciones al click en cita (PRO)
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

  // ✅ Guard de sesión
  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login?redirectTo=/admin/agenda");
        return;
      }
      setAuthChecked(true);
    };
    run();
  }, [router]);

  /**
   * ✅ Carga clientes del tenant para el autocomplete del modal.
   * - Mapea full_name -> name
   */
  const loadCustomers = async () => {
    const { data, error } = await supabase
      .from("customers")
      .select("id, full_name, phone")
      .eq("tenant_id", TENANT_ID)
      .order("full_name", { ascending: true })
      .limit(500);

    if (error) {
      console.error("Error loading customers:", error);
      return;
    }

    const list: CustomerLite[] =
      (data ?? []).map((c: any) => ({
        id: c.id,
        name: c.full_name,
        phone: c.phone ?? null,
      })) ?? [];

    setCustomers(list);
  };

  // ✅ Background de NO disponible según availability + rango visible
  useEffect(() => {
    if (!authChecked) return;
    if (!selectedProfessionalId) return;
    if (!visibleRange) return;

    const blocksForPro: any[] = [];
    const proMap = availabilityMap[selectedProfessionalId] ?? {};
    Object.keys(proMap).forEach((dayKey) => {
      const day = Number(dayKey);
      (proMap[day] ?? []).forEach((b) => blocksForPro.push(b));
    });

    const bg = buildUnavailableBgEvents({
      rangeStartISO: visibleRange.start,
      rangeEndISO: visibleRange.end,
      blocks: blocksForPro,
      slotMinTime: "07:00:00",
      slotMaxTime: "21:00:00",
    });

    setBgEvents(bg);
  }, [authChecked, selectedProfessionalId, visibleRange?.start, visibleRange?.end, availabilityMap]);

  const onLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // ✅ NO TRASLAPES
  const hasOverlap = async (startISO: string, endISO: string, professionalId: string, excludeId?: string) => {
    let q = supabase
      .from("appointments")
      .select("id")
      .eq("tenant_id", TENANT_ID)
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

  const loadProfessionals = async () => {
    const { data, error } = await supabase
      .from("professionals")
      .select("id, name, tenant_id")
      .eq("tenant_id", TENANT_ID)
      .order("name", { ascending: true });

    if (error) {
      console.error("Error loading professionals:", error);
      return;
    }

    const list = (data as Professional[] | null) ?? [];
    setProfessionals(list);

    if (!selectedProfessionalId && list.length > 0) {
      setSelectedProfessionalId(list[0].id);
    }
  };

  const loadAvailability = async () => {
    const { data, error } = await supabase
      .from("availability")
      .select("professional_id, day_of_week, start_time, end_time, is_active")
      .eq("tenant_id", TENANT_ID)
      .eq("is_active", true);

    if (error) {
      console.error("Error cargando availability:", error);
      setAvailabilityMap({});
      return;
    }

    const map: AvailabilityMap = {};
    ((data as AvailabilityRow[] | null) ?? []).forEach((a) => {
      if (!map[a.professional_id]) map[a.professional_id] = {};
      if (!map[a.professional_id][a.day_of_week]) map[a.professional_id][a.day_of_week] = [];
      map[a.professional_id][a.day_of_week].push(a);
    });

    setAvailabilityMap(map);
  };

  /**
   * ✅ Cargar citas con JOIN a customers
   * Nota: customers puede venir como array => tomamos el [0]
   */
  const loadAppointments = async (start?: string, end?: string, professionalId?: string) => {
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
        status,
        customers (
          full_name,
          phone
        )
      `
      )
      .eq("tenant_id", TENANT_ID)
      .order("start_at", { ascending: true });

    if (professionalId) q = q.eq("professional_id", professionalId);
    if (start && end) q = q.gte("start_at", start).lt("start_at", end);

    const { data, error } = await q;

    if (error) {
      console.error("Error loading appointments:", error);
      setLoading(false);
      return;
    }

    const mapped =
      (data as Appointment[] | null)?.map((a) => {
        const isCanceled = a.status === "canceled";

        const joinedCustomer = a.customers?.[0] ?? null;
        const customerFullName = joinedCustomer?.full_name ?? null;
        const customerPhone = joinedCustomer?.phone ?? null;

        const titleBase = customerFullName ?? a.customer_name ?? "Cita";

        return {
          id: a.id,
          title: isCanceled ? `❌ ${titleBase}` : titleBase,
          start: a.start_at,
          end: a.end_at,
          extendedProps: {
            professional_id: a.professional_id,
            customer_phone: customerPhone ?? a.customer_phone,
            status: a.status ?? "confirmed",
            customer_id: a.customer_id ?? null,
          },
        };
      }) ?? [];

    setEvents(mapped);
    setLoading(false);
  };

  // ✅ Cargar data cuando auth OK
  useEffect(() => {
    if (!authChecked) return;

    loadProfessionals();
    loadAvailability();
    loadCustomers();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked]);

  // ✅ Recargar citas cuando cambie profesional o rango
  useEffect(() => {
    if (!authChecked) return;
    if (!selectedProfessionalId) return;

    if (visibleRange) {
      loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    } else {
      loadAppointments(undefined, undefined, selectedProfessionalId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, selectedProfessionalId, visibleRange?.start, visibleRange?.end]);

  /**
   * ✅ Crear cita: validaciones + abre modal
   */
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

  /**
   * ✅ Inserta cita con customer_id + legacy fields
   */
  async function createAppointmentWithCustomer(customerId: string) {
    if (!slot) return;

    const customer = customers.find((c) => c.id === customerId) ?? null;

    const { error } = await supabase.from("appointments").insert([
      {
        tenant_id: TENANT_ID,
        professional_id: selectedProfessionalId,
        customer_id: customerId,
        customer_name: customer?.name ?? null,
        customer_phone: customer?.phone ?? null,
        start_at: slot.startISO,
        end_at: slot.endISO,
        status: "confirmed",
      },
    ]);

    if (error) {
      console.error("Error creating appointment:", error);
      alert("Error creando cita");
      return;
    }

    // cerrar modal y limpiar
    setCreateOpen(false);
    setSlot(null);

    if (visibleRange) await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    else await loadAppointments(undefined, undefined, selectedProfessionalId);
  }

  // ✅ MOVER (drag&drop)
  const handleEventDrop = async (dropInfo: EventDropArg) => {
    const id = dropInfo.event.id;

    const startDate = dropInfo.event.start;
    const endDate = dropInfo.event.end;

    if (!startDate || !endDate) {
      alert("Rango inválido");
      dropInfo.revert();
      return;
    }

    const start_at = startDate.toISOString();
    const end_at = endDate.toISOString();

    const dayOfWeek = startDate.getDay();
    const startMin = dateToMinutes(startDate);
    const endMin = dateToMinutes(endDate);

    const blocks = availabilityMap[selectedProfessionalId]?.[dayOfWeek] ?? [];
    if (!isWithinAvailability({ startMin, endMin, blocks })) {
      alert("❌ No se puede mover: fuera de disponibilidad");
      dropInfo.revert();
      return;
    }

    const overlap = await hasOverlap(start_at, end_at, selectedProfessionalId, id);
    if (overlap) {
      alert("❌ Ese horario ya está ocupado (no se permiten traslapes).");
      dropInfo.revert();
      return;
    }

    const { error } = await supabase.from("appointments").update({ start_at, end_at }).eq("id", id);

    if (error) {
      console.error("Error updating appointment:", error);
      alert("Error moviendo cita");
      dropInfo.revert();
      return;
    }

    if (visibleRange) await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    else await loadAppointments(undefined, undefined, selectedProfessionalId);
  };

  async function cancelAppointment(appointmentId: string) {
    const { error } = await supabase.from("appointments").update({ status: "canceled" }).eq("id", appointmentId);

    if (error) {
      console.error("Error canceling appointment:", error);
      alert("Error cancelando cita");
      return;
    }

    if (visibleRange) await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    else await loadAppointments(undefined, undefined, selectedProfessionalId);
  }

  // ✅ Click en cita (PRO): abre panel con acciones
  const handleEventClick = async (clickInfo: EventClickArg) => {
    const id = clickInfo.event.id;
    const title = clickInfo.event.title;

    const customerPhone = (clickInfo.event.extendedProps as any)?.customer_phone ?? null;
    const customerId = (clickInfo.event.extendedProps as any)?.customer_id ?? null;

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

  // ✅ Cuando cambie de semana
  const handleDatesSet = async (arg: DatesSetArg) => {
    const start = arg.startStr;
    const end = arg.endStr;

    setVisibleRange({ start, end });

    if (!selectedProfessionalId) return;
    await loadAppointments(start, end, selectedProfessionalId);
  };

  if (!authChecked) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Validando sesión...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, fontFamily: "system-ui" }}>
      <h1>Agenda (Admin)</h1>

      <style>{`
        .fc-bg-unavailable {
          background: rgba(0,0,0,0.08);
        }
      `}</style>

      <button
        onClick={onLogout}
        style={{
          padding: 8,
          marginTop: 8,
          cursor: "pointer",
          borderRadius: 8,
          border: "1px solid #ddd",
          background: "white",
        }}
      >
        Cerrar sesión
      </button>

      <a
        href="/admin/customers"
        style={{
          display: "inline-block",
          padding: "8px 12px",
          marginLeft: 10,
          borderRadius: 8,
          border: "1px solid #ddd",
          background: "white",
          textDecoration: "none",
          color: "inherit",
          fontSize: 14,
        }}
      >
        Clientes
      </a>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Profesional</div>
          <select
            value={selectedProfessionalId}
            onChange={(e) => setSelectedProfessionalId(e.target.value)}
            style={{ padding: "8px 10px", minWidth: 240 }}
          >
            {professionals.length === 0 ? (
              <option value="">Cargando profesionales...</option>
            ) : (
              professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? "(sin nombre)"}
                </option>
              ))
            )}
          </select>
        </div>

        <div style={{ fontSize: 13, opacity: 0.8 }}>
          Tenant: {TENANT_ID} {loading ? "• cargando..." : ""}
          <div style={{ fontSize: 12, opacity: 0.7 }}>Mostrando: {selectedProfessional?.name ?? "-"}</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
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
          slotMinTime="07:00:00"
          slotMaxTime="21:00:00"
        />
      </div>

      <p style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Tip: seleccionar un rango = crear cita • arrastrar = reprogramar • click = acciones
      </p>

      {/* ✅ Modal Día 6 */}
      <AppointmentCreateModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setSlot(null);
        }}
        startISO={slot?.startISO ?? ""}
        endISO={slot?.endISO ?? ""}
        customers={customers}
        tenantId={TENANT_ID}
        onCreatedCustomer={(c) => {
          // ✅ agregar sin duplicar
          setCustomers((prev) => {
            if (prev.some((x) => x.id === c.id)) return prev;
            return [c, ...prev];
          });
        }}
        onConfirm={async ({ customerId }) => {
          await createAppointmentWithCustomer(customerId);
        }}
      />

      {/* ✅ Modal acciones al click en cita (PRO) */}
      {actionOpen && selectedEvent && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 60,
          }}
        >
          <div
            style={{
              width: "min(540px, 100%)",
              background: "white",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800 }}>Cita</div>
                {(() => {
                  const { date, startTime, endTime } = formatDateTimeRange(selectedEvent.startISO, selectedEvent.endISO);
                  return (
                    <>
                      <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 700 }}>{selectedEvent.title}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        📅 {date} • 🕒 {startTime} – {endTime}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{selectedEvent.customerPhone ?? "(sin teléfono)"}</div>
                    </>
                  );
                })()}
              </div>

              <button
                onClick={() => {
                  setActionOpen(false);
                  setSelectedEvent(null);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                Cerrar
              </button>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <button
                onClick={() => {
                  if (!selectedEvent.customerPhone) {
                    alert("Esta cita no tiene teléfono.");
                    return;
                  }
                  const p = normalizePhoneToWhatsApp(selectedEvent.customerPhone);
                  window.open(`https://wa.me/${p}`, "_blank");
                }}
                disabled={!selectedEvent.customerPhone}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #111",
                  background: "#111",
                  color: "white",
                  cursor: selectedEvent.customerPhone ? "pointer" : "not-allowed",
                  opacity: selectedEvent.customerPhone ? 1 : 0.5,
                }}
              >
                Abrir WhatsApp
              </button>

              <button
                onClick={() => {
                  const { date, startTime, endTime } = formatDateTimeRange(selectedEvent.startISO, selectedEvent.endISO);
                  const customerName = selectedEvent.title.replace(/^❌\s*/, "").trim() || "cliente";

                  const msg = buildConfirmationMessage({
                    customerName,
                    dateLabel: date,
                    startTime,
                    endTime,
                    businessName: "Citaya", // cámbialo después por el nombre del negocio
                  });

                  navigator.clipboard.writeText(msg);
                  alert("✅ Mensaje copiado al portapapeles");
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                Copiar mensaje confirmación
              </button>

              <button
                onClick={() => {
                  if (!selectedEvent.customerPhone) {
                    alert("Esta cita no tiene teléfono.");
                    return;
                  }

                  const { date, startTime, endTime } = formatDateTimeRange(selectedEvent.startISO, selectedEvent.endISO);
                  const customerName = selectedEvent.title.replace(/^❌\s*/, "").trim() || "cliente";

                  const msg = buildConfirmationMessage({
                    customerName,
                    dateLabel: date,
                    startTime,
                    endTime,
                    businessName: "Citaya",
                  });

                  const p = normalizePhoneToWhatsApp(selectedEvent.customerPhone);
                  const url = `https://wa.me/${p}?text=${encodeURIComponent(msg)}`;
                  window.open(url, "_blank");
                }}
                disabled={!selectedEvent.customerPhone}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #111",
                  background: "#111",
                  color: "white",
                  cursor: selectedEvent.customerPhone ? "pointer" : "not-allowed",
                  opacity: selectedEvent.customerPhone ? 1 : 0.5,
                }}
              >
                WhatsApp con mensaje listo
              </button>

              <button
                onClick={async () => {
                  const ok = confirm("¿Cancelar esta cita?");
                  if (!ok) return;

                  await cancelAppointment(selectedEvent.id);

                  setActionOpen(false);
                  setSelectedEvent(null);
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                Cancelar cita
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
