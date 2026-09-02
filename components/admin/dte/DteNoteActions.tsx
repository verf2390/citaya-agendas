"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/api/adminFetch";

export default function DteNoteActions({ intentId, originalAmount, onCreated }: { intentId: string; originalAmount: number; onCreated: () => void }) {
  const [type, setType] = useState<56 | 61 | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(originalAmount);
  const [reviewing, setReviewing] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!type || reason.trim().length < 10 || !Number.isSafeInteger(amount) || amount <= 0 || saving || !reviewing) return;
    setSaving(true);
    setError("");
    const response = await adminFetch(`/api/admin/dte-intents/${intentId}/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ dteType: type, reason, adjustmentAmount: amount, referenceCode: "3", reviewAccepted: true }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "No se pudo crear la nota.");
      return;
    }
    setType(null);
    setReason("");
    setReviewing(false);
    onCreated();
  };

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <button type="button" onClick={() => { setType(61); setAmount(originalAmount); setReviewing(false); }} className="font-bold text-blue-700">Nota de crédito</button>
        <button type="button" onClick={() => { setType(56); setAmount(originalAmount); setReviewing(false); }} className="font-bold text-blue-700">Nota de débito</button>
      </div>
      {type ? (
        <div className="min-w-64 rounded-xl border bg-white p-2">
          <label className="grid gap-1 text-xs font-bold">Motivo operacional
            <textarea value={reason} onChange={(event) => { setReason(event.target.value); setReviewing(false); }} minLength={10} maxLength={500} className="min-h-16 rounded-lg border p-2" />
          </label>
          <label className="mt-2 grid gap-1 text-xs font-bold">Monto del ajuste (CodRef 3)
            <input type="number" min={1} max={originalAmount} value={amount} onChange={(event) => { setAmount(Number(event.target.value)); setReviewing(false); }} className="h-9 rounded-lg border px-2" />
          </label>
          {reviewing ? <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs"><b>Revisión final:</b> nota {type}, referencia al DTE original, ajuste de {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount)}. <button type="button" disabled={saving} onClick={() => void submit()} className="mt-2 block rounded-lg bg-slate-900 px-3 py-1.5 font-black text-white">Confirmar nota</button></div> : <button type="button" disabled={reason.trim().length < 10 || !Number.isSafeInteger(amount) || amount <= 0 || amount > originalAmount} onClick={() => { setIdempotencyKey(crypto.randomUUID()); setReviewing(true); }} className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40">Revisar nota {type}</button>}
          <button type="button" onClick={() => { setType(null); setReviewing(false); }} className="ml-2 text-xs font-bold">Cancelar</button>
          {error ? <p className="mt-1 text-xs font-bold text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
