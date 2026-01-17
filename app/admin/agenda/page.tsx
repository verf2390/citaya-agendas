"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

type AppointmentStatus = "confirmed" | "completed" | "canceled" | "no_show";

type Appointment = {
  id: string;
  tenant_id: string;
  professional_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  start_at: string;
  end_at: string;
  status?: AppointmentStatus | null;
};

type Professional = {
  id: string;
  name: string | null;
  tenant_id: string;
};

type AvailabilityRow = {
  professional_id: string;
  day_of_week: number; // 0-6 (domingo=0)
  start_time: string;  // "09:00:00" o "09:00"
  end_time: string;    // "18:00:00" o "18:00"
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
function isWithinAvailability(params: {
  startMin: number;
  endMin: number;
  blocks: AvailabilityRow[];
}) {
  const { startMin, endMin, blocks } = params;
  if (!blocks || blocks.length === 0) return false;

  return blocks.some((b) => {
    const bs = timeToMinutes(b.start_time);
    const be = timeToMinutes(b.end_time);
    return startMin >= bs && endMin <= be; // contiguo permitido
  });
}

function minutesToTime(min: number) {
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
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
  blocks: { day_of_week: number; start_time: string; end_time: string }[]; // del día seleccionado
  slotMinTime: string; // "07:00:00"
  slotMaxTime: string; // "21:00:00"
}) {
  const { rangeStartISO, rangeEndISO, blocks, slotMinTime, slotMaxTime } = params;

  const rangeStart = new Date(rangeStartISO);
  const rangeEnd = new Date(rangeEndISO);

  const results: any[] = [];

  // Recorremos cada día en el rango visible (semana)
  for (let d = new Date(rangeStart); d < rangeEnd; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay(); // 0-6

    const dayBlocks = blocks
      .filter((b) => b.day_of_week === dayOfWeek)
      .slice()
      .sort((a, b) => (a.start_time > b.start_time ? 1 : -1));

    const dayStart = setTimeOnDate(d, slotMinTime);
    const dayEnd = setTimeOnDate(d, slotMaxTime);

    // Si no hay bloques => todo el día (en la ventana) es NO disponible
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

    // Construimos los "huecos" NO disponibles:
    // [slotMin -> primer bloque], (entre bloques), [último bloque -> slotMax]
    let cursor = dayStart;

    for (const b of dayBlocks) {
      const blockStart = setTimeOnDate(d, b.start_time);
      const blockEnd = setTimeOnDate(d, b.end_time);

      // Hueco antes del bloque
      if (cursor < blockStart) {
        results.push({
          id: `bg-${d.toISOString()}-${cursor.toISOString()}`,
          start: cursor.toISOString(),
          end: blockStart.toISOString(),
          display: "background",
          classNames: ["fc-bg-unavailable"],
        });
      }

      // Mover cursor al fin del bloque
      cursor = blockEnd;
    }

    // Hueco después del último bloque
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

useEffect(() => {
  if (!authChecked) return;
  if (!selectedProfessionalId) return;
  if (!visibleRange) return;

  // Tomamos availability del profesional seleccionado (todos los días)
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
  const hasOverlap = async (
    startISO: string,
    endISO: string,
    professionalId: string,
    excludeId?: string
  ) => {
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
      return true; // por seguridad bloquea si falla
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
    (data as AvailabilityRow[] | null ?? []).forEach((a) => {
      if (!map[a.professional_id]) map[a.professional_id] = {};
      if (!map[a.professional_id][a.day_of_week]) map[a.professional_id][a.day_of_week] = [];
      map[a.professional_id][a.day_of_week].push(a);
    });

    setAvailabilityMap(map);
  };

  const loadAppointments = async (start?: string, end?: string, professionalId?: string) => {
    setLoading(true);

    let q = supabase
      .from("appointments")
      .select("*")
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
        const titleBase = a.customer_name ?? "Cita";

        return {
          id: a.id,
          title: isCanceled ? `❌ ${titleBase}` : titleBase,
          start: a.start_at,
          end: a.end_at,
          extendedProps: {
            professional_id: a.professional_id,
            customer_phone: a.customer_phone,
            status: a.status ?? "confirmed",
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

  // ✅ CREAR CITA (Disponibilidad + no-traslapes)
  const handleSelect = async (selectInfo: DateSelectArg) => {
    if (!selectedProfessionalId) {
      alert("Selecciona un profesional primero");
      return;
    }

    const customer_name = prompt("Nombre cliente?");
    if (!customer_name) return;

    // ✅ usa Date objects del calendario (evita líos de timezone)
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

    const { error } = await supabase.from("appointments").insert([
      {
        tenant_id: TENANT_ID,
        professional_id: selectedProfessionalId,
        customer_name,
        customer_phone: "",
        start_at,
        end_at,
        status: "confirmed", // ✅ válido en tu constraint
      },
    ]);

    if (error) {
      console.error("Error creating appointment:", error);
      alert("Error creando cita");
      return;
    }

    if (visibleRange) await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    else await loadAppointments(undefined, undefined, selectedProfessionalId);
  };

  // ✅ MOVER (drag&drop) (Disponibilidad + no-traslapes)
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

    const { error } = await supabase
      .from("appointments")
      .update({ start_at, end_at })
      .eq("id", id);

    if (error) {
      console.error("Error updating appointment:", error);
      alert("Error moviendo cita");
      dropInfo.revert();
      return;
    }

    if (visibleRange) await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    else await loadAppointments(undefined, undefined, selectedProfessionalId);
  };

  // ✅ Cancelar (no borrar)
  const handleEventClick = async (clickInfo: EventClickArg) => {
    const ok = confirm(`¿Cancelar cita de "${clickInfo.event.title}"?`);
    if (!ok) return;

    const { error } = await supabase
      .from("appointments")
      .update({ status: "canceled" })
      .eq("id", clickInfo.event.id);

    if (error) {
      console.error("Error canceling appointment:", error);
      alert("Error cancelando cita");
      return;
    }

    if (visibleRange) await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    else await loadAppointments(undefined, undefined, selectedProfessionalId);
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
`     }</style>


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
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Mostrando: {selectedProfessional?.name ?? "-"}
          </div>
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
        Tip: seleccionar un rango = crear cita • arrastrar = reprogramar • click = cancelar
      </p>
    </main>
  );
}
