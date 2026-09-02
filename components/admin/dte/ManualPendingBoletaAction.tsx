"use client";

import { useState } from "react";

import { adminFetch } from "@/lib/api/adminFetch";

export default function ManualPendingBoletaAction(props: {
  intentId: string;
  dteType: 33 | 39;
  onProcessed: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");

  const process = async () => {
    if (busy || locked) return;
    setBusy(true);
    setLocked(true);
    setMessage("");
    const response = await adminFetch(
      `/api/admin/dte-intents/${props.intentId}/process-manual`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: `PROCESAR ${props.intentId}` }),
      },
    );
    const payload = await response.json().catch(() => null);
    setBusy(false);
    setConfirming(false);
    setMessage(payload?.message ?? payload?.error ?? "No se pudo procesar la emisión.");
    props.onProcessed();
  };

  if (message) return <p className="text-xs font-bold text-slate-700">{message}</p>;
  if (!confirming) {
    return (
      <button type="button" disabled={locked} onClick={() => setConfirming(true)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
        Continuar emisión de {props.dteType === 39 ? "boleta" : "factura"}
      </button>
    );
  }
  return (
    <div className="max-w-md rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <p className="font-bold leading-5">
        Se procesará la {props.dteType === 39 ? "Boleta 39" : "Factura 33"} ya confirmada. Esta acción reservará exactamente un folio tributario y realizará un único envío al SII.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || locked} onClick={() => void process()} className="rounded-lg bg-slate-900 px-3 py-2 font-black text-white disabled:opacity-50">
          {busy ? "Procesando…" : "Sí, continuar emisión"}
        </button>
        <button type="button" disabled={busy || locked} onClick={() => setConfirming(false)} className="rounded-lg border border-amber-400 bg-white px-3 py-2 font-black disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  );
}
