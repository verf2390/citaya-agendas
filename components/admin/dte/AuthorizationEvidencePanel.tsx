"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/api/adminFetch";

type Evidence = {
  id: string;
  authorization_date: string;
  authorized_types: number[];
  evidence_source: string;
  evidence_fingerprint: string;
  registered_at: string;
  status: "current" | "revoked";
};

export default function AuthorizationEvidencePanel() {
  const [items, setItems] = useState<Evidence[]>([]);
  const [canReconcile, setCanReconcile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [issuerRut, setIssuerRut] = useState("");
  const [authorizationDate, setAuthorizationDate] = useState("");
  const [types, setTypes] = useState<number[]>([]);
  const [source, setSource] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [observation, setObservation] = useState("");
  const [saving, setSaving] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const response = await adminFetch("/api/admin/dte-authorization", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "No se pudo cargar la autorización.");
      return;
    }
    setItems(payload.evidence ?? []);
    setCanReconcile(payload.canReconcile === true);
  };
  useEffect(() => { void Promise.resolve().then(load); }, []);

  const save = async () => {
    setSaving(true);
    setError("");
    const response = await adminFetch("/api/admin/dte-authorization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issuerRut, authorizationDate, authorizedTypes: types,
        evidenceSource: source, evidenceFingerprint: fingerprint,
        observation,
      }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "No se pudo reconciliar la evidencia.");
      return;
    }
    setOpen(false);
    await load();
  };
  const revoke = async () => {
    if (saving || revokeReason.trim().length < 10) return;
    setSaving(true); setError("");
    const response = await adminFetch("/api/admin/dte-authorization", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: revokeReason }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !payload?.ok) { setError(payload?.error ?? "No se pudo revocar la autorización."); return; }
    setRevokeReason(""); await load();
  };
  const current = items.find((item) => item.status === "current");

  return (
    <div className="grid gap-3">
      {loading ? <p role="status" className="text-sm font-bold text-slate-600">Cargando autorización…</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900">{error} <button type="button" onClick={() => void load()} className="ml-2 underline">Reintentar</button></p> : null}
      {!loading && !current ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">Autorización SII pendiente de reconciliación.</p> : null}
      {current ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="font-bold text-slate-500">Autorización SII</dt><dd className="font-black">Vigente</dd></div>
          <div><dt className="font-bold text-slate-500">Tipos autorizados</dt><dd className="font-black">{[...current.authorized_types].sort((a, b) => a - b).join(", ")}</dd></div>
          <div><dt className="font-bold text-slate-500">Fecha</dt><dd>{current.authorization_date}</dd></div>
          <div><dt className="font-bold text-slate-500">Evidencia</dt><dd title={current.evidence_fingerprint}>{current.evidence_source} · {current.evidence_fingerprint.slice(0, 12)}…</dd></div>
        </dl>
      ) : null}
      {canReconcile && current ? (
        <div className="grid gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
          <label className="grid gap-1 text-sm font-bold text-red-900">Motivo de revocación
            <input value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} className="h-10 rounded-xl border border-red-200 bg-white px-3" />
          </label>
          <button type="button" onClick={() => void revoke()} disabled={saving || revokeReason.trim().length < 10} className="w-fit rounded-xl bg-red-900 px-3 py-2 text-xs font-black text-white disabled:opacity-40">Revocar autorización y pausar emisión</button>
        </div>
      ) : null}
      {canReconcile ? <button type="button" onClick={() => setOpen((value) => !value)} className="w-fit rounded-xl border px-3 py-2 text-sm font-black">{open ? "Cancelar" : "Registrar evidencia"}</button> : null}
      {open ? (
        <div className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-bold">RUT emisor<input value={issuerRut} onChange={(event) => setIssuerRut(event.target.value)} className="h-11 rounded-xl border px-3" /></label>
          <label className="grid gap-1 text-sm font-bold">Fecha de autorización<input type="date" value={authorizationDate} onChange={(event) => setAuthorizationDate(event.target.value)} className="h-11 rounded-xl border px-3" /></label>
          <fieldset className="sm:col-span-2"><legend className="text-sm font-bold">Tipos autorizados</legend><div className="mt-2 flex flex-wrap gap-3">{[33, 39, 56, 61].map((type) => <label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={types.includes(type)} onChange={(event) => setTypes(event.target.checked ? [...types, type] : types.filter((value) => value !== type))} />{type}</label>)}</div></fieldset>
          <label className="grid gap-1 text-sm font-bold">Fuente de evidencia<input value={source} onChange={(event) => setSource(event.target.value)} className="h-11 rounded-xl border px-3" /></label>
          <label className="grid gap-1 text-sm font-bold">SHA-256 / fingerprint<input value={fingerprint} onChange={(event) => setFingerprint(event.target.value.toLowerCase())} maxLength={64} className="h-11 rounded-xl border px-3 font-mono text-xs" /></label>
          <label className="grid gap-1 text-sm font-bold sm:col-span-2">Observación<textarea value={observation} onChange={(event) => setObservation(event.target.value)} className="min-h-20 rounded-xl border p-3" /></label>
          <button type="button" onClick={() => void save()} disabled={saving || types.length === 0 || !/^[a-f0-9]{64}$/.test(fingerprint)} className="w-fit rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300">{saving ? "Registrando…" : "Registrar autorización"}</button>
        </div>
      ) : null}
    </div>
  );
}
