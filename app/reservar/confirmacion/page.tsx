"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Appt = {
  id: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string;
  professional_id: string;
  tenant_id: string;
};

export default function ConfirmacionPage() {
  return (
    <Suspense fallback={<ConfirmacionFallback />}>
      <ConfirmacionInner />
    </Suspense>
  );
}

function ConfirmacionFallback() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 6 }}>Cargando…</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>Estamos preparando los detalles de tu cita.</p>
    </main>
  );
}

function ConfirmacionInner() {
  const sp = useSearchParams();

  // Confirmación definitiva: SOLO por ?id=UUID
  const id = sp.get("id") ?? "";

  // 🚫 Sin id = link inválido (no renderizar confirmación)
  if (!id) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ marginBottom: 6 }}>⚠️ Link inválido</h1>
        <p style={{ color: "crimson", fontWeight: 700 }}>Falta el id de la cita.</p>
      </main>
    );
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [appt, setAppt] = useState<Appt | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError("");

        const res = await fetch(`/api/appointments/by-id?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });

        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? `Error cargando cita (${res.status})`);
        }

        if (!cancelled) setAppt(json.appointment as Appt);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "No se pudo cargar la cita");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // 🚫 Si hubo error cargando la cita, no mostrar confirmación
  if (error) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ marginBottom: 6 }}>⚠️ No se pudo cargar la cita</h1>
        <p style={{ marginTop: 0, color: "crimson", fontWeight: 700 }}>{error}</p>
      </main>
    );
  }

  // Datos a mostrar (solo desde la cita real)
  const start = appt?.start_at ?? "";
  const email = appt?.customer_email ?? "";
  const phone = appt?.customer_phone ?? "";
  const prof = "Profesional";

  // Normaliza teléfono a formato internacional CHILE: 56 + 9 + XXXXXXXX
  const phoneE164 = useMemo(() => {
    const raw = String(phone ?? "").trim();
    if (!raw) return "";

    const digits = raw.replace(/\D/g, "");

    if (digits.startsWith("569") && digits.length >= 11) return digits;
    if (digits.startsWith("56") && digits.length >= 11) return digits;
    if (digits.startsWith("9") && digits.length >= 9) return `56${digits}`;

    return "";
  }, [phone]);

  const wa = useMemo(() => {
    if (!phoneE164) return "";
    const msg = encodeURIComponent("Hola, acabo de reservar una cita. ¿Me confirmas por favor?");
    const isMobile =
      typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    return isMobile
      ? `https://api.whatsapp.com/send?phone=${phoneE164}&text=${msg}`
      : `https://web.whatsapp.com/send?phone=${phoneE164}&text=${msg}`;
  }, [phoneE164]);

  const canOpenWA = !!wa;

  const startLabel = useMemo(() => {
    if (!start) return "—";
    return new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago",
      weekday: "long",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(start));
  }, [start]);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
    <>
      <h1>✅ Reserva registrada</h1>
      <p style={{ marginTop: 4, opacity: 0.8 }}>
      Te enviamos un correo con los detalles de tu cita.
      Desde ahí podrás cancelarla o reagendarla si lo necesitas.
    </p>
    </>

      {loading && <p style={{ marginTop: 10, opacity: 0.75 }}>Cargando detalles de tu cita…</p>}

      <section
        style={{
          marginTop: 14,
          padding: 16,
          border: "1px solid #c7f0d8",
          background: "#f0fff6",
          borderRadius: 12,
        }}
      >
        <p style={{ margin: 0 }}>
          <b>Profesional:</b> {prof}
        </p>
        <p style={{ margin: "8px 0 0 0" }}>
          <b>Fecha/Hora:</b> {startLabel}
        </p>
        <p style={{ margin: "8px 0 0 0" }}>
          <b>Correo:</b> {email || "—"}
        </p>
        <p style={{ margin: "8px 0 0 0" }}>
          <b>Celular:</b> {phone || "—"}
        </p>

        <div style={{ marginTop: 14 }}>
          <a
            href={canOpenWA ? wa : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!canOpenWA}
            onClick={(e) => {
              if (!canOpenWA) e.preventDefault();
            }}
            style={{
              display: "inline-block",
              padding: "10px 12px",
              borderRadius: 12,
              background: canOpenWA ? "#111" : "#999",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 800,
              cursor: canOpenWA ? "pointer" : "not-allowed",
              userSelect: "none",
            }}
          >
            Abrir WhatsApp (opcional)
          </a>
        </div>

        {!canOpenWA && (
          <p style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
            No se pudo generar el link de WhatsApp (faltó un celular válido).
          </p>
        )}
      </section>
    </main>
  );
}
