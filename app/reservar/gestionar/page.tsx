"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Appointment = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  start_at: string;
  end_at: string;
  status: string;
};

const SLOT_MINUTES = 60; // tramos de 1 hora

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

function addMinutes(localInput: string, minutes: number) {
  // localInput: yyyy-MM-ddTHH:mm
  const d = new Date(localInput);
  d.setMinutes(d.getMinutes() + minutes);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

function ManageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [appt, setAppt] = useState<Appointment | null>(null);

  const [newStart, setNewStart] = useState(""); // solo inicio
  const newEnd = useMemo(() => (newStart ? addMinutes(newStart, SLOT_MINUTES) : ""), [newStart]);

  const isCanceled = appt?.status === "canceled";

  const go = (url: string) => {
    // Router push + fallback por si el cliente no navega por alguna razón
    try {
      router.push(url);
      // fallback suave por si no navega (no bloquea si sí navega)
      setTimeout(() => {
        if (typeof window !== "undefined" && window.location.pathname !== "/reservar/resultado") {
          // si ya navegó, no hace nada; si no, fuerza navegación
          window.location.href = url;
        }
      }, 250);
    } catch {
      if (typeof window !== "undefined") window.location.href = url;
    }
  };

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setErr("Falta el token.");
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/appointments/by-token?token=${encodeURIComponent(token)}`);
      const json = await res.json();

      if (!json.ok) {
        setErr(json.error ?? "Token inválido.");
        setLoading(false);
        return;
      }

      const a: Appointment = json.appointment;
      setAppt(a);
      setNewStart(toLocalInput(a.start_at)); // fin queda auto por SLOT_MINUTES
      setLoading(false);
    };

    run().catch((e) => {
      console.error(e);
      setErr("Error cargando la cita.");
      setLoading(false);
    });
  }, [token]);

  const cancel = async () => {
    if (!token || busy) return;
    setBusy(true);
    setErr(null);

    try {
      const res = await fetch("/api/appointments/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const json = await res.json();
      if (!json.ok) {
        setErr(json.error ?? "No se pudo cancelar.");
        return;
      }

      setAppt((prev) => (prev ? { ...prev, status: "canceled" } : prev));
      go("/reservar/resultado?status=canceled");
    } catch (e) {
      console.error(e);
      setErr("Error cancelando la cita.");
    } finally {
      setBusy(false);
    }
  };

  const reschedule = async () => {
    if (!token || busy) return;
    setErr(null);

    if (!newStart || !newEnd) {
      setErr("Debes elegir una nueva hora de inicio.");
      return;
    }

    setBusy(true);

    try {
      const startISO = new Date(newStart).toISOString();
      const endISO = new Date(newEnd).toISOString();

      const res = await fetch("/api/appointments/reschedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, start_at: startISO, end_at: endISO }),
      });

      const json = await res.json();
      if (!json.ok) {
        setErr(json.error ?? "No se pudo reagendar.");
        return;
      }

      setAppt((prev) =>
        prev
          ? { ...prev, start_at: json.appointment.start_at, end_at: json.appointment.end_at }
          : prev
      );

      const url =
        `/reservar/resultado?status=rescheduled` +
        `&start=${encodeURIComponent(json.appointment.start_at)}` +
        `&end=${encodeURIComponent(json.appointment.end_at)}`;

      go(url);
    } catch (e) {
      console.error(e);
      setErr("Error reagendando la cita.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main style={{ padding: 24 }}>Cargando…</main>;

  if (err) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
        <h1>Gestionar cita</h1>
        <p style={{ color: "crimson" }}>{err}</p>
      </main>
    );
  }

  if (!appt) return null;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
      <h1>Gestionar cita</h1>

      <div style={{ marginTop: 12, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
        <div>
          <b>Estado:</b> {appt.status}
        </div>
        <div>
          <b>Cliente:</b> {appt.customer_name ?? "—"}
        </div>
        <div>
          <b>Teléfono:</b> {appt.customer_phone ?? "—"}
        </div>
        <div>
          <b>Email:</b> {appt.customer_email ?? "—"}
        </div>

        <div style={{ marginTop: 8 }}>
          <b>Inicio:</b>{" "}
          {new Date(appt.start_at).toLocaleString("es-CL", { timeZone: "America/Santiago" })}
        </div>
        <div>
          <b>Fin:</b>{" "}
          {new Date(appt.end_at).toLocaleString("es-CL", { timeZone: "America/Santiago" })}
        </div>
      </div>

      <h2 style={{ marginTop: 20 }}>Reagendar</h2>

      <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
        <label>
          Nueva hora inicio
          <input
            type="datetime-local"
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
            disabled={!!isCanceled || busy}
            style={{ width: "100%", padding: 8 }}
          />
        </label>

        <div style={{ fontSize: 14, color: "#444" }}>
          <b>Duración:</b> {SLOT_MINUTES} min &nbsp;·&nbsp; <b>Nueva hora fin:</b>{" "}
          {newEnd ? newEnd.replace("T", " ") : "—"}
        </div>

        <button
          onClick={reschedule}
          disabled={!!isCanceled || busy}
          style={{
            padding: 12,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "white",
            cursor: isCanceled || busy ? "not-allowed" : "pointer",
            fontWeight: 600,
            opacity: isCanceled || busy ? 0.7 : 1,
          }}
        >
          {busy ? "Guardando..." : `Guardar reagendamiento (+${SLOT_MINUTES} min)`}
        </button>
      </div>

      <h2 style={{ marginTop: 22 }}>Acciones</h2>

      <div style={{ marginTop: 10 }}>
        <button
          onClick={cancel}
          disabled={!!isCanceled || busy}
          style={{
            padding: 12,
            borderRadius: 10,
            border: 0,
            background: "crimson",
            color: "white",
            cursor: isCanceled || busy ? "not-allowed" : "pointer",
            fontWeight: 600,
            opacity: isCanceled || busy ? 0.7 : 1,
          }}
        >
          {busy ? "Procesando..." : "Cancelar cita"}
        </button>

        {isCanceled && (
          <p style={{ marginTop: 10, color: "#666" }}>Esta cita ya está cancelada.</p>
        )}
      </div>
    </main>
  );
}

export default function ManagePage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Cargando…</main>}>
      <ManageInner />
    </Suspense>
  );
}
