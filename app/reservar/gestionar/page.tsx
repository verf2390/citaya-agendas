"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Appointment = {
  id: string;
  tenant_id: string;
  professional_id: string;
  start_at: string;
  end_at: string;
  status: "confirmed" | "completed" | "canceled" | "no_show";
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
};

export default function GestionarReservaPage() {
  const sp = useSearchParams();
  const token = sp.get("token");

  const [loading, setLoading] = useState(true);
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);

  // MVP: usar input datetime-local
  const [newStart, setNewStart] = useState("");

  // Formato CL bonito
  const formatCL = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("es-CL", {
      timeZone: "America/Santiago",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Cargar cita usando token
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      setMsg(null);

      if (!token) {
        setError("❌ Falta token. Abre el link desde tu correo.");
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/appointments/manage?token=${encodeURIComponent(token)}`);
      const json = await res.json();

      if (!res.ok) {
        setError(json?.error ?? "❌ No se pudo cargar la reserva.");
        setLoading(false);
        return;
      }

      setAppt(json.appointment);
      setLoading(false);
    };

    load();
  }, [token]);

  // Cancelar
  const cancelAppointment = async () => {
    if (!token) return;

    setMsg(null);

    const res = await fetch("/api/appointments/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const json = await res.json();

    if (!res.ok) {
      setMsg("❌ " + (json?.error ?? "Error al cancelar"));
      return;
    }

    setMsg("✅ Reserva cancelada correctamente.");
    setAppt((prev) => (prev ? { ...prev, status: "canceled" } : prev));
  };

  // Reprogramar
  const rescheduleAppointment = async () => {
    if (!token) return;
    if (!newStart) {
      setMsg("⚠️ Selecciona una nueva fecha/hora.");
      return;
    }

    setMsg(null);

    // datetime-local no trae zona -> se interpreta en hora local del navegador
    const newStartISO = new Date(newStart).toISOString();

    const res = await fetch("/api/appointments/reschedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_start_at: newStartISO }),
    });

    const json = await res.json();

    if (!res.ok) {
      setMsg("❌ " + (json?.error ?? "Error al reprogramar"));
      return;
    }

    setMsg("✅ Reserva reprogramada correctamente.");
    setAppt((prev) =>
      prev
        ? {
            ...prev,
            start_at: json.start_at,
            end_at: json.end_at,
            status: "confirmed",
          }
        : prev
    );
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 26, marginBottom: 12 }}>Gestionar reserva</h1>

      {loading && <p>Cargando…</p>}

      {!loading && error && (
        <div style={{ padding: 14, border: "1px solid #f5c2c7", borderRadius: 12 }}>
          <p style={{ color: "crimson", margin: 0 }}>{error}</p>
        </div>
      )}

      {!loading && appt && (
        <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 16 }}>
          <p style={{ marginTop: 0 }}>
            <b>Estado:</b> {appt.status}
          </p>

          <p>
            <b>Cliente:</b> {appt.customer_name ?? "-"}
          </p>

          <p>
            <b>Correo:</b> {appt.customer_email ?? "-"}
          </p>

          <p>
            <b>Teléfono:</b> {appt.customer_phone ?? "-"}
          </p>

          <p>
            <b>Fecha y hora:</b> {formatCL(appt.start_at)}
          </p>

          <hr style={{ margin: "16px 0" }} />

          <h2 style={{ fontSize: 18, marginBottom: 10 }}>Acciones</h2>

          {/* Cancelar */}
          <button
            onClick={cancelAppointment}
            disabled={appt.status === "canceled"}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #333",
              cursor: appt.status === "canceled" ? "not-allowed" : "pointer",
              marginRight: 10,
            }}
          >
            Cancelar reserva
          </button>

          {/* Reprogramar */}
          <div style={{ marginTop: 16 }}>
            <p style={{ marginBottom: 8 }}>
              <b>Reprogramar</b> (MVP: selecciona nueva fecha/hora)
            </p>

            <input
              type="datetime-local"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #999",
              }}
              disabled={appt.status === "canceled"}
            />

            <button
              onClick={rescheduleAppointment}
              disabled={appt.status === "canceled" || !newStart}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #333",
                cursor: appt.status === "canceled" || !newStart ? "not-allowed" : "pointer",
                marginLeft: 10,
              }}
            >
              Confirmar cambio
            </button>

            <p style={{ marginTop: 10, color: "#666" }}>
              Próximo upgrade: mostrar <b>slots disponibles</b> reales usando tu endpoint de
              disponibilidad ✅
            </p>
          </div>

          {msg && <p style={{ marginTop: 14 }}>{msg}</p>}
        </div>
      )}
    </main>
  );
}
