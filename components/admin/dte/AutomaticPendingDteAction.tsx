"use client";

import { useState } from "react";

import { adminFetch } from "@/lib/api/adminFetch";

export default function AutomaticPendingDteAction(props: {
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
    try {
      const response = await adminFetch(
        `/api/admin/dte-intents/${props.intentId}/process-automatic`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: `EJECUTAR ${props.intentId}` }),
        },
      );
      const payload = await response.json().catch(() => null);
      setMessage(
        payload?.message ?? payload?.error ??
          "No se pudo procesar la emisión automática.",
      );
    } catch {
      setMessage("No se pudo procesar la emisión automática.");
    } finally {
      setBusy(false);
      setConfirming(false);
      props.onProcessed();
    }
  };

  if (message) {
    return <p className="text-xs font-bold text-slate-700">{message}</p>;
  }
  if (!confirming) {
    return (
      <button
        type="button"
        disabled={locked}
        onClick={() => setConfirming(true)}
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
      >
        Ejecutar DTE automático
      </button>
    );
  }
  return (
    <div className="max-w-md rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <p className="font-bold leading-5">
        Se procesará exactamente esta {props.dteType === 39 ? "Boleta 39" : "Factura 33"}.
        La acción puede consumir un folio tributario y enviar el documento al SII.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || locked}
          onClick={() => void process()}
          className="rounded-lg bg-slate-900 px-3 py-2 font-black text-white disabled:opacity-50"
        >
          {busy ? "Procesando…" : "Sí, ejecutar este DTE"}
        </button>
        <button
          type="button"
          disabled={busy || locked}
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-amber-400 bg-white px-3 py-2 font-black disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
