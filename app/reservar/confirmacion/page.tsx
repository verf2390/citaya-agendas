"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Next App Router: useSearchParams() debe ir dentro de <Suspense>.
 * Por eso separamos en wrapper + inner.
 */
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

  const start = sp.get("start") ?? "";
  const prof = sp.get("prof") ?? "Profesional";
  const wa = sp.get("wa") ?? "";
  const email = sp.get("email") ?? "";
  const phone = sp.get("phone") ?? "";

  const startLabel = useMemo(() => {
    if (!start) return "—";
    return new Intl.DateTimeFormat("es-CL", {
      weekday: "long",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(start));
  }, [start]);

  const canOpenWA = wa.startsWith("https://wa.me/");

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 6 }}>✅ Reserva confirmada</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Tu solicitud fue registrada. En el MVP, la confirmación será por correo.
      </p>

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
            href={canOpenWA ? wa : "#"}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              padding: "10px 12px",
              borderRadius: 12,
              background: canOpenWA ? "#111" : "#999",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 800,
              pointerEvents: canOpenWA ? "auto" : "none",
            }}
          >
            Abrir WhatsApp (opcional)
          </a>
        </div>

        {!canOpenWA && (
          <p style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
            No se recibió link de WhatsApp (revisa que la URL tenga parámetros).
          </p>
        )}

        <p style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
          Próximo paso (Día 10/11): automatizar confirmación y recordatorios con n8n usando el correo.
        </p>
      </section>
    </main>
  );
}

