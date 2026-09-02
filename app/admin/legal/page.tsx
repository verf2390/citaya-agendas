"use client";

import { useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/admin/AdminNav";
import { AdminPageHeader, AdminPageShell, AdminSectionCard } from "@/components/admin/admin-ui";
import { toast } from "@/components/ui/use-toast";
import { adminFetch } from "@/lib/api/adminFetch";
import {
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DRAFT_TEMPLATES,
  LEGAL_REVIEW_NOTICE,
  type LegalDocumentType,
} from "@/lib/legal/templates";

type LegalProfile = {
  trade_name?: string | null;
  contact_address?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
  privacy_contact_name?: string | null;
  privacy_contact_email?: string | null;
  tenant_is_service_provider?: boolean;
  handles_sensitive_data?: boolean | null;
  sensitive_data_review_status?: "pending" | "confirmed_no" | "confirmed_yes";
  sensitive_data_purpose?: string | null;
  administrative_review_status?: "draft" | "complete";
};
type LegalDocument = {
  id: string; document_type: LegalDocumentType; version: number; title: string;
  content: string; content_sha256: string; status: "draft" | "published" | "retired";
  effective_at?: string | null; published_at?: string | null;
};
type Gate = Record<string, boolean | string> & { ready: boolean };
type Payload = {
  tenant?: { name?: string | null; operational_mode?: "unclassified" | "demo" | "live" | "internal" };
  tax?: { issuer_legal_name?: string | null; issuer_rut?: string | null; issuer_address?: string | null };
  profile?: LegalProfile | null;
  documents?: LegalDocument[];
  mandates?: Array<{ id: string; signer_full_name: string; signer_capacity: string; accepted_at: string; evidence_kind: string }>;
  acceptances?: Array<{ id: string; document_version: number; actor_type: string; acceptance_context: string; accepted_declaration: string; accepted_at: string }>;
  gate?: Gate;
};

const GATE_LABELS: Record<string, string> = {
  identityLegalComplete: "Identidad legal completa",
  taxDataComplete: "Datos tributarios completos",
  termsPublished: "Términos publicados",
  privacyPublished: "Privacidad publicada",
  cancellationRefundPublished: "Cancelaciones y reembolsos publicados",
  dteAuthorityReady: "Autoridad DTE válida",
  sensitiveDataReviewed: "Tratamiento sensible revisado",
  sensitiveConsentConfigured: "Consentimiento sensible configurado",
};

function fieldClass() {
  return "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400";
}
export default function LegalAdminPage() {
  const [data, setData] = useState<Payload>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<LegalProfile>({});
  const [documentType, setDocumentType] = useState<LegalDocumentType>("consumer_terms");
  const [draftId, setDraftId] = useState("");
  const [title, setTitle] = useState<string>(LEGAL_DOCUMENT_LABELS.consumer_terms);
  const [content, setContent] = useState<string>(LEGAL_DRAFT_TEMPLATES.consumer_terms);
  const [signer, setSigner] = useState({ name: "", rut: "", capacity: "", authority: false, operations: false, custody: false });

  const refresh = async () => {
    const response = await adminFetch("/api/admin/legal", { cache: "no-store" });
    const json = await response.json().catch(() => null) as ({ ok?: boolean; error?: string } & Payload) | null;
    if (!response.ok || !json?.ok) throw new Error(json?.error ?? "No se pudo cargar Legal y privacidad");
    setData(json);
    setProfile(json.profile ?? {});
  };

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      toast({ title: cause instanceof Error ? cause.message : "No se pudo cargar", variant: "destructive" });
    }).finally(() => setLoading(false));
  }, []);

  const selectedVersions = useMemo(
    () => (data.documents ?? []).filter((document) => document.document_type === documentType),
    [data.documents, documentType],
  );
  const publishedMandate = (data.documents ?? []).find(
    (document) => document.document_type === "dte_mandate" && document.status === "published",
  );

  const request = async (method: "PATCH" | "POST", body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const response = await adminFetch("/api/admin/legal", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => null) as ({ ok?: boolean; error?: string } & Payload) | null;
      if (!response.ok || !json?.ok) throw new Error(json?.error ?? "No se pudo guardar");
      setData(json); setProfile(json.profile ?? {});
      toast({ title: "Cambio legal guardado" });
    } catch (cause) {
      toast({ title: cause instanceof Error ? cause.message : "No se pudo guardar", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const chooseType = (next: LegalDocumentType) => {
    setDocumentType(next);
    const draft = (data.documents ?? []).find((document) => document.document_type === next && document.status === "draft");
    setDraftId(draft?.id ?? "");
    setTitle(draft?.title ?? LEGAL_DOCUMENT_LABELS[next]);
    setContent(draft?.content ?? LEGAL_DRAFT_TEMPLATES[next]);
  };

  if (loading) return <main className="p-6 text-sm">Cargando Legal y privacidad…</main>;

  return (
    <AdminPageShell>
      <AdminNav />
      <AdminPageHeader eyebrow="Cumplimiento" title="Legal y privacidad" description="Identidad, documentos, consentimientos y gate previo a emisión. La emisión tipo 39 no se activa desde esta página." />

      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
        {LEGAL_REVIEW_NOTICE}
      </div>

      <AdminSectionCard className="mt-5" title="Estado del gate legal" description={data.gate?.ready ? "Gate legal listo; los gates tributarios y técnicos siguen siendo independientes." : "Incompleto: no puede habilitarse boleta 39."}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(GATE_LABELS).map(([key, label]) => (
            <div key={key} className={`rounded-xl border p-3 text-sm font-bold ${data.gate?.[key] ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              {data.gate?.[key] ? "✓" : "○"} {label}
            </div>
          ))}
        </div>
      </AdminSectionCard>

      <AdminSectionCard className="mt-5" title="Identidad legal del prestador" description="La razón social y el RUT se leen desde la configuración tributaria maestra; no se duplican aquí.">
        <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <div><strong>Razón social:</strong> {data.tax?.issuer_legal_name || "Pendiente en configuración tributaria"}</div>
          <div><strong>RUT:</strong> {data.tax?.issuer_rut || "Pendiente en configuración tributaria"}</div>
          <div><strong>Dirección tributaria:</strong> {data.tax?.issuer_address || "Pendiente en configuración tributaria"}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Nombre comercial", "trade_name"], ["Dirección de contacto", "contact_address"],
            ["Correo de soporte/reclamos", "support_email"], ["Teléfono (opcional)", "support_phone"],
            ["Responsable de privacidad", "privacy_contact_name"], ["Correo de privacidad", "privacy_contact_email"],
          ].map(([label, key]) => <label key={key} className="text-sm font-bold text-slate-700">{label}<input className={fieldClass()} value={String(profile[key as keyof LegalProfile] ?? "")} onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        </div>
        <label className="mt-4 flex gap-2 text-sm font-bold"><input type="checkbox" checked={profile.tenant_is_service_provider === true} onChange={(event) => setProfile((current) => ({ ...current, tenant_is_service_provider: event.target.checked }))} /> El tenant es quien presta y vende el servicio al consumidor.</label>
        <label className="mt-3 block text-sm font-bold">Revisión de datos sensibles
          <select className={fieldClass()} value={profile.sensitive_data_review_status ?? "pending"} onChange={(event) => {
            const status = event.target.value as NonNullable<LegalProfile["sensitive_data_review_status"]>;
            setProfile((current) => ({
              ...current,
              sensitive_data_review_status: status,
              handles_sensitive_data: status === "confirmed_yes" ? true : status === "confirmed_no" ? false : null,
              sensitive_data_purpose: status === "confirmed_yes" ? current.sensitive_data_purpose : null,
            }));
          }}>
            <option value="pending">Pendiente de revisar</option>
            <option value="confirmed_no">Revisado: no trata datos sensibles</option>
            <option value="confirmed_yes">Revisado: sí trata datos sensibles</option>
          </select>
        </label>
        {profile.sensitive_data_review_status === "confirmed_yes" ? <label className="mt-3 block text-sm font-bold">Finalidad específica<textarea className={`${fieldClass()} min-h-24`} value={profile.sensitive_data_purpose ?? ""} onChange={(event) => setProfile((current) => ({ ...current, sensitive_data_purpose: event.target.value }))} /></label> : null}
        <div className="mt-4 flex gap-2">
          <button disabled={saving} onClick={() => void request("PATCH", { action: "profile", tradeName: profile.trade_name, contactAddress: profile.contact_address, supportEmail: profile.support_email, supportPhone: profile.support_phone, privacyContactName: profile.privacy_contact_name, privacyContactEmail: profile.privacy_contact_email, tenantIsServiceProvider: profile.tenant_is_service_provider, sensitiveDataReviewStatus: profile.sensitive_data_review_status ?? "pending", sensitiveDataPurpose: profile.sensitive_data_purpose, administrativeReviewStatus: profile.administrative_review_status })} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">Guardar</button>
          <button disabled={saving} onClick={() => setProfile((current) => ({ ...current, administrative_review_status: current.administrative_review_status === "complete" ? "draft" : "complete" }))} className="rounded-xl border px-4 py-2 text-sm font-black">Marcar {profile.administrative_review_status === "complete" ? "en revisión" : "completo"}</button>
        </div>
      </AdminSectionCard>

      <AdminSectionCard className="mt-5" title="Documentos versionados" description="Una versión publicada queda inmutable. Los campos [PENDIENTE: …] impiden publicar.">
        <select className="rounded-xl border px-3 py-2 text-sm font-bold" value={documentType} onChange={(event) => chooseType(event.target.value as LegalDocumentType)}>
          {Object.entries(LEGAL_DOCUMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="mt-4 block text-sm font-bold">Título<input className={fieldClass()} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="mt-3 block text-sm font-bold">Contenido<textarea className={`${fieldClass()} min-h-64 font-mono text-xs leading-5`} value={content} onChange={(event) => setContent(event.target.value)} /></label>
        <button disabled={saving} onClick={() => void request("PATCH", { action: "draft", id: draftId || null, documentType, title, content })} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">Guardar borrador</button>
        <div className="mt-5 grid gap-2">
          {selectedVersions.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"><div><strong>v{document.version} · {document.status}</strong><div className="text-xs text-slate-500">SHA-256 {document.content_sha256.slice(0, 12)}…</div></div>{document.status === "draft" ? <button disabled={saving} onClick={() => { if (window.confirm("La versión publicada será inmutable. ¿Publicar ahora?")) void request("POST", { action: "publish", documentId: document.id }); }} className="rounded-lg border px-3 py-2 font-bold">Publicar versión</button> : null}</div>)}
        </div>
      </AdminSectionCard>

      <AdminSectionCard className="mt-5" title={data.tenant?.operational_mode === "internal" ? "Emisor propio" : "Mandato operativo DTE"} description={data.tenant?.operational_mode === "internal" ? "La autoridad de emisor propio es evidencia administrativa de plataforma y no un mandato de tercero." : "Evidencia contractual electrónica; no es firma electrónica avanzada."}>
        {data.tenant?.operational_mode === "internal" ? <p className="text-sm text-slate-700">R&G opera sus propios DTE. Un platform admin debe registrar la autoridad self-issued por separado; esta página no crea mandatos artificiales.</p> : <>
        {!publishedMandate ? <p className="text-sm text-amber-800">Primero publica una versión completa del mandato DTE.</p> : <div className="grid gap-3 sm:grid-cols-3"><input className={fieldClass()} placeholder="Nombre completo" value={signer.name} onChange={(event) => setSigner((current) => ({ ...current, name: event.target.value }))} /><input className={fieldClass()} placeholder="RUT firmante" value={signer.rut} onChange={(event) => setSigner((current) => ({ ...current, rut: event.target.value }))} /><input className={fieldClass()} placeholder="Cargo o calidad" value={signer.capacity} onChange={(event) => setSigner((current) => ({ ...current, capacity: event.target.value }))} /></div>}
        {publishedMandate ? <><label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={signer.authority} onChange={(event) => setSigner((current) => ({ ...current, authority: event.target.checked }))} /> Declaro contar con facultades para representar al tenant.</label><label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={signer.operations} onChange={(event) => setSigner((current) => ({ ...current, operations: event.target.checked }))} /> Autorizo generar, firmar, enviar, consultar y conservar DTE.</label><label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={signer.custody} onChange={(event) => setSigner((current) => ({ ...current, custody: event.target.checked }))} /> Autorizo custodiar certificado y CAF bajo controles de seguridad.</label><button disabled={saving || !signer.authority || !signer.operations || !signer.custody} onClick={() => { if (window.confirm("¿Registrar esta aceptación electrónica del mandato?")) void request("POST", { action: "mandate", documentId: publishedMandate.id, signerFullName: signer.name, signerRut: signer.rut, signerCapacity: signer.capacity, confirmAuthority: signer.authority, confirmOperations: signer.operations, confirmCustody: signer.custody }); }} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Aceptar mandato</button></> : null}
        {(data.mandates ?? []).map((mandate) => <div key={mandate.id} className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><strong>{mandate.signer_full_name}</strong> · {mandate.signer_capacity} · {new Date(mandate.accepted_at).toLocaleString("es-CL")}</div>)}
        </>}
      </AdminSectionCard>

      <AdminSectionCard className="mt-5" title="Evidencias recientes" description="Vista restringida y minimizada; no expone IP ni user-agent.">
        <div className="grid gap-2">{(data.acceptances ?? []).map((item) => <div key={item.id} className="rounded-xl border p-3 text-sm"><strong>{item.acceptance_context}</strong> · v{item.document_version} · {item.actor_type}<div className="mt-1 text-xs text-slate-500">{new Date(item.accepted_at).toLocaleString("es-CL")}</div></div>)}</div>
      </AdminSectionCard>
    </AdminPageShell>
  );
}
