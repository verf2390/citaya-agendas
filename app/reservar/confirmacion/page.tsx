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
      <h1 style={{ marginBottom: 6 }}>✅ Reserva confirmada</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>Cargando detalles…</p>
    </main>
  );
}

function ConfirmacionInner() {
  const sp = useSearchParams();

  // Nuevo: soportar ?id=...
  const id = sp.get("id") ?? "";

  // Fallback (modo antiguo por query params)
  const startQP = sp.get("start") ?? "";
  const profQP = sp.get("prof") ?? "Profesional";
  const emailQP = sp.get("email") ?? "";
  const phoneQP = sp.get("phone") ?? "";

  const [loading, setLoading] = useState<boolean>(!!id);
  const [error, setError] = useState<string>("");
  const [appt, setAppt] = useState<Appt | null>(null);

  useEffect(() => {
    if (!id) return;

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

  // Datos finales a mostrar (prioriza appt si existe)
  const start = appt?.start_at ?? startQP;
  const email = appt?.customer_email ?? emailQP;
  const phone = appt?.customer_phone ?? phoneQP;

  // (por ahora) nombre del profesional
  const prof = profQP;

  // Normaliza teléfono a formato internacional CHILE: 56 + 9 + XXXXXXXX
  const phoneE164 = useMemo(() => {
    const raw = String(phone ?? "").trim();
    if (!raw) return "";

    const digits = raw.replace(/\D/g, ""); // solo números

    // Si viene como 569XXXXXXXX -> ok
    if (digits.startsWith("569") && digits.length >= 11) return digits;

    // Si viene como 56 + algo
    if (digits.startsWith("56") && digits.length >= 11) return digits;

    // Si viene como 9XXXXXXXX (9 dígitos) -> agregar 56
    if (digits.startsWith("9") && digits.length >= 9) return `56${digits}`;

    // Si viene como XXXXXXXX (sin 9) no adivinamos
    return "";
  }, [phone]);


  const wa = useMemo(() => {
    if (!phoneE164) return "";
    const msg = encodeURIComponent("Hola, acabo de reservar una cita. ¿Me confirmas por favor?");
    const isMobile =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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
      <h1 style={{ marginBottom: 6 }}>✅ Reserva confirmada</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Tu solicitud fue registrada. En el MVP, la confirmación será por correo.
      </p>

      {loading && <p style={{ marginTop: 10, opacity: 0.75 }}>Cargando detalles de tu cita…</p>}

      {!!error && (
        <p style={{ marginTop: 10, color: "crimson" }}>
          {error} {id ? `(id: ${id})` : ""}
        </p>
      )}

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

	<p style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
           <b>DEBUG wa:</b> {wa || "(vacío)"} <br />
           <b>DEBUG phoneE164:</b> {phoneE164 || "(vacío)"}
        </p>


        {!canOpenWA && (
          <p style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
            No se pudo generar el link de WhatsApp (faltó un celular válido).
          </p>
        )}
      </section>
    </main>
  );
}
