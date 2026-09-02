"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/api/adminFetch";

type GateResponse = {
  ok: boolean;
  gates: Record<string, boolean>;
  activation: { status: string };
  canActivate: boolean;
  confirmationPrompt: string | null;
};

const labels: Record<string, string> = {
  issuerDataExact: "Datos exactos del emisor",
  issuerLegalNameMatch: "Razón social coincidente",
  typeAuthorized: "Tipo autorizado por SII",
  certificateCurrent: "Certificado vigente",
  certificateKeyMatch: "Certificado y llave coinciden",
  certificateRutMatch: "RUT compatible con certificado",
  officialTrustAnchor: "Trust anchor oficial con SHA fijado",
  authenticTypeCaf: "CAF productivo auténtico del tipo",
  foliosAvailable: "Folios disponibles",
  tenantAwareLedger: "Ledger aislado por tenant",
  privateStorage: "Storage privado",
  productionEndpoints: "Endpoints productivos",
  officialXsd: "XSD oficial",
  xmlDsig: "XMLDSig validado",
  workerConfigured: "Worker configurado",
  migrationsApplied: "Migraciones aplicadas",
  offlinePreflightComplete: "Preflight offline completo",
  documentEngineReady: "Motor productivo validado para el tipo",
  globalFeatureEnabled: "Feature flag global habilitable",
};

export default function LegalActivationControl() {
  const [type, setType] = useState<33 | 39 | 56 | 61>(33);
  const [state, setState] = useState<GateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    const response = await adminFetch(`/api/admin/dte-activation?type=${type}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok || !payload?.ok) {
      setState(null);
      setError(payload?.error ?? "No se pudo ejecutar el preflight.");
      return;
    }
    setState(payload);
  };
  // load intentionally refreshes when the selected DTE type changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void Promise.resolve().then(load); }, [type]);

  const mutate = async (action: "activate" | "pause") => {
    if (!state || saving) return;
    setSaving(true);
    const response = await adminFetch("/api/admin/dte-activation", {
      method: action === "activate" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "activate"
        ? { dteType: type, confirmation }
        : { dteType: type, reason: pauseReason }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "La acción no pudo completarse.");
      return;
    }
    setConfirmation("");
    setPauseReason("");
    await load();
  };

  return (
    <div className="grid gap-4">
      <label className="grid max-w-xs gap-1 text-sm font-bold">Tipo de documento
        <select value={type} onChange={(event) => setType(Number(event.target.value) as typeof type)} className="h-11 rounded-xl border px-3">
          <option value={33}>Factura 33</option>
          <option value={39}>Boleta 39</option>
          <option value={56}>Nota de débito 56</option>
          <option value={61}>Nota de crédito 61</option>
        </select>
      </label>
      {loading ? <p role="status" className="text-sm font-bold text-slate-600">Ejecutando preflight offline…</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900">{error} <button type="button" onClick={() => void load()} className="ml-2 underline">Reintentar</button></p> : null}
      {state ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(labels).map(([key, label]) => (
              <div key={key} className={`rounded-xl border p-3 text-sm font-bold ${state.gates[key] ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                {state.gates[key] ? "✓" : "×"} {label}
              </div>
            ))}
          </div>
          <p className="text-sm font-black">Estado: {state.activation.status === "active" ? "Emisión activa" : state.activation.status === "paused" ? "Emisión pausada" : state.gates.ready ? "Lista para activar" : "Acciones pendientes"}</p>
          {state.canActivate && state.activation.status !== "active" ? (
            <div className="rounded-2xl border border-slate-300 p-4">
              <p className="text-xs text-slate-600">Para confirmar, escribe exactamente:</p>
              <code className="mt-1 block break-all text-xs">{state.confirmationPrompt}</code>
              <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-3 h-11 w-full rounded-xl border px-3 text-sm" />
              <button type="button" disabled={saving || confirmation !== state.confirmationPrompt || state.gates.ready !== true} onClick={() => void mutate("activate")} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300">Activar emisión legal</button>
            </div>
          ) : null}
          {state.canActivate && state.activation.status === "active" ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <textarea value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} className="min-h-20 w-full rounded-xl border p-3 text-sm" placeholder="Motivo operacional de la pausa" />
              <button type="button" disabled={saving || pauseReason.trim().length < 10} onClick={() => void mutate("pause")} className="mt-2 rounded-xl bg-amber-900 px-4 py-2 text-sm font-black text-white disabled:opacity-40">Pausar emisión</button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
