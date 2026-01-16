"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

import type {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  DatesSetArg,
} from "@fullcalendar/core";

import { supabase } from "@/lib/supabaseClient";

type Appointment = {
  id: string;
  tenant_id: string;
  professional_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  start_at: string;
  end_at: string;
  status?: string | null;
};

type Professional = {
  id: string;
  name: string | null;
  tenant_id: string;
};

// ⚠️ MVP: tenant hardcodeado. Luego lo sacamos desde profiles/slug.
const TENANT_ID = "04d6c088-338d-44b2-b27b-b4709f48d31b";

export default function AgendaPage() {
  const router = useRouter();

  // ✅ Día 3: guard de sesión
  const [authChecked, setAuthChecked] = useState(false);

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

  const onLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string>("");

  const [visibleRange, setVisibleRange] = useState<{ start: string; end: string } | null>(null);

  const selectedProfessional = useMemo(() => {
    return professionals.find((p) => p.id === selectedProfessionalId) ?? null;
  }, [professionals, selectedProfessionalId]);

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
            status: a.status ?? "booked",
          },
        };
      }) ?? [];

    setEvents(mapped);
    setLoading(false);
  };

  // ✅ Cargar data solo cuando auth está OK
  useEffect(() => {
    if (!authChecked) return;
    loadProfessionals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked]);

  useEffect(() => {
    if (!authChecked) return;
    if (!selectedProfessionalId) return;

    if (visibleRange) {
      loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    } else {
      loadAppointments(undefined, undefined, selectedProfessionalId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, selectedProfessionalId]);

  const handleSelect = async (selectInfo: DateSelectArg) => {
    if (!selectedProfessionalId) {
      alert("Selecciona un profesional primero");
      return;
    }

    const customer_name = prompt("Nombre cliente?");
    if (!customer_name) return;

    const start_at = selectInfo.startStr;
    const end_at = selectInfo.endStr;

    const { error } = await supabase.from("appointments").insert([
      {
        tenant_id: TENANT_ID,
        professional_id: selectedProfessionalId,
        customer_name,
        customer_phone: "",
        start_at,
        end_at,
        status: "booked",
      },
    ]);

    if (error) {
      console.error("Error creating appointment:", error);
      alert("Error creando cita");
      return;
    }

    if (visibleRange) {
      await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    } else {
      await loadAppointments(undefined, undefined, selectedProfessionalId);
    }
  };

  const handleEventDrop = async (dropInfo: EventDropArg) => {
    const id = dropInfo.event.id;
    const start_at = dropInfo.event.start?.toISOString();
    const end_at = dropInfo.event.end?.toISOString();

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

    if (visibleRange) {
      await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    } else {
      await loadAppointments(undefined, undefined, selectedProfessionalId);
    }
  };

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

    if (visibleRange) {
      await loadAppointments(visibleRange.start, visibleRange.end, selectedProfessionalId);
    } else {
      await loadAppointments(undefined, undefined, selectedProfessionalId);
    }
  };

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
          selectable
          editable
          select={handleSelect}
          eventDrop={handleEventDrop}
          eventClick={handleEventClick}
          datesSet={handleDatesSet}
          events={events}
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
