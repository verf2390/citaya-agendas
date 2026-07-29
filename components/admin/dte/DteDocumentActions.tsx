"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/api/adminFetch";

export default function DteDocumentActions(props: {
  intentId: string;
  productionDocumentId: string;
  canViewTrackId: boolean;
  canDownloadXml: boolean;
  canDownloadPdf: boolean;
  canEmail: boolean;
}) {
  const [detail, setDetail] = useState<{ hasTrackId: boolean; trackIdFingerprint: string | null; status: string; siiStatus: string | null } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const view = async () => {
    setBusy("view");
    setError("");
    const response = await adminFetch(`/api/admin/dte-production/${props.productionDocumentId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    setBusy("");
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "No se pudo cargar el detalle.");
      return;
    }
    setDetail(payload.detail.document);
  };

  const download = async (kind: "dte_xml" | "pdf") => {
    setBusy(kind);
    setError("");
    const response = await adminFetch(`/api/admin/dte-production/${props.productionDocumentId}/artifacts/${kind}`, { cache: "no-store" });
    if (!response.ok) {
      setBusy("");
      setError("Descarga no disponible.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${props.productionDocumentId}.${kind === "pdf" ? "pdf" : "xml"}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setBusy("");
  };

  const email = async () => {
    setBusy("email");
    setError("");
    const response = await adminFetch(`/api/admin/dte-intents/${props.intentId}/email`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    const payload = await response.json().catch(() => null);
    setBusy("");
    if (!response.ok || !payload?.ok) setError(payload?.error ?? "No se pudo encolar el email.");
  };

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void view()} disabled={!props.canViewTrackId || Boolean(busy)} className="font-bold text-blue-700 disabled:text-slate-300">Track ID</button>
        <button type="button" onClick={() => void download("dte_xml")} disabled={!props.canDownloadXml || Boolean(busy)} className="font-bold text-blue-700 disabled:text-slate-300">XML</button>
        <button type="button" onClick={() => void download("pdf")} disabled={!props.canDownloadPdf || Boolean(busy)} className="font-bold text-blue-700 disabled:text-slate-300">PDF</button>
        <button type="button" onClick={() => void email()} disabled={!props.canEmail || Boolean(busy)} className="font-bold text-blue-700 disabled:text-slate-300">Reenviar email</button>
      </div>
      {detail ? <p className="text-xs text-slate-600">Track ID: {detail.hasTrackId ? `registrado (${detail.trackIdFingerprint})` : "aún no asignado"} · {detail.siiStatus || detail.status}</p> : null}
      {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
