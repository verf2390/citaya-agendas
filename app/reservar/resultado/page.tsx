"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function ResultInner() {
  const sp = useSearchParams();
  const status = sp.get("status"); // "rescheduled" | "canceled"
  const start = sp.get("start");
  const end = sp.get("end");

  const title =
    status === "rescheduled"
      ? "✅ Tu cita ha sido reagendada"
      : status === "canceled"
      ? "✅ Tu cita ha sido cancelada"
      : "✅ Listo";

  const pretty = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("es-CL", { timeZone: "America/Santiago" });
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
      <h1>{title}</h1>

      {(status === "rescheduled") && (
        <div style={{ marginTop: 12, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
          <div>
            <b>Nuevo inicio:</b> {pretty(start)}
          </div>
          <div>
            <b>Nuevo fin:</b> {pretty(end)}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <a href="/reservar" style={{ textDecoration: "underline" }}>
          Volver a reservar
        </a>
      </div>
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Cargando…</main>}>
      <ResultInner />
    </Suspense>
  );
}
