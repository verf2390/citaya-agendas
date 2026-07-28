"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Pencil,
  ReceiptText,
  RefreshCcw,
  Save,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import AdminNav from "@/components/admin/AdminNav";
import AdvancedBillingTechnicalPanel from "@/components/admin/dte/AdvancedBillingTechnicalPanel";
import ManualIssuanceForm from "@/components/admin/dte/ManualIssuanceForm";
import LegalActivationControl from "@/components/admin/dte/LegalActivationControl";
import AuthorizationEvidencePanel from "@/components/admin/dte/AuthorizationEvidencePanel";
import DteNoteActions from "@/components/admin/dte/DteNoteActions";
import DteDocumentActions from "@/components/admin/dte/DteDocumentActions";
import DeclarationReadinessCard, {
  type DeclarationReadinessState,
} from "@/components/admin/dte/DeclarationReadinessCard";
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  EmptyState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { adminFetch } from "@/lib/api/adminFetch";

type Step = { key: string; label: string; ready: boolean; detail: string; action: string };
type DocumentRow = {
  id: string;
  productionDocumentId: string | null;
  type: number | null;
  folio: number | null;
  customer: string;
  amount: number;
  status: string;
  date: string;
  blockingReason: string | null;
  canView: boolean;
  canDownload: boolean;
  canQuery: boolean;
  canCreateNote: boolean;
  canEmail: boolean;
};
type BillingState = {
  globalProductionEnabled: boolean;
  technicalAccess: boolean;
  status: { label: string; ready: boolean; preparedPendingActivation: boolean; missingSteps: number; blockingReason: string | null };
  steps: Step[];
  policy: {
    issuanceMode: "manual" | "automatic_on_verified_payment";
    consumerDocumentType: "39" | "41" | "unsupported";
    invoiceOnRequest: boolean;
    autoEmailDelivery: boolean;
    effectiveAutomatic: boolean;
  };
  tax: {
    legalName: string; taxId: string; businessActivity: string; address: string;
    commune: string; city: string; email: string; phone: string;
    taxTreatment: "affected" | "exempt" | "mixed" | "unconfigured";
  };
  readiness: {
    productionEnabled: boolean;
    siiAuthorizationStatus: string;
    certificateReady: boolean;
    cafReady: boolean;
    lastCheck: string | null;
    folios: Record<string, { available: number; reserved: number; issued: number }>;
  };
  declaration: DeclarationReadinessState;
  documents: DocumentRow[];
};

function money(value: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value || 0);
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(date);
}

function documentLabel(type: number | null) {
  if (type === 33) return "Factura electrónica";
  if (type === 39) return "Boleta afecta";
  if (type === 41) return "Boleta exenta";
  return "Documento pendiente";
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-bold text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-medium outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
      />
    </label>
  );
}

async function fetchBillingState(): Promise<BillingState> {
  const response = await adminFetch("/api/admin/dte-settings", { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? "No se pudo cargar facturación.");
  }
  return payload.state as BillingState;
}

function billingErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo cargar facturación.";
}

export default function AdminFacturacionPage() {
  const [state, setState] = useState<BillingState | null>(null);
  const [draft, setDraft] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingTax, setEditingTax] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const nextState = await fetchBillingState();
      setState(nextState);
      setDraft(nextState);
    } catch (loadError) {
      setError(billingErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.has("appointmentId") || params.has("customerId")) setManualOpen(true);
    });
    void fetchBillingState()
      .then((nextState) => {
        if (!active) return;
        setState(nextState);
        setDraft(nextState);
      })
      .catch((loadError) => {
        if (active) setError(billingErrorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError("");
    const response = await adminFetch("/api/admin/dte-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issuanceMode: draft.policy.issuanceMode,
        consumerDocumentType: draft.policy.consumerDocumentType,
        invoiceOnRequest: draft.policy.invoiceOnRequest,
        autoEmailDelivery: draft.policy.autoEmailDelivery,
        taxTreatment: draft.tax.taxTreatment,
        tax: draft.tax,
      }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "No se pudo guardar facturación.");
      return;
    }
    setState(payload.state);
    setDraft(payload.state);
    setEditingTax(false);
  };

  const activationTone = state?.status.ready ? "green" : state?.status.preparedPendingActivation ? "blue" : "amber";
  const automaticConfigured = draft?.policy.issuanceMode === "automatic_on_verified_payment";
  const automaticGateReason = useMemo(() => {
    if (!state) return "";
    if (!state.globalProductionEnabled) return "La activación legal global sigue deshabilitada.";
    const missing = state.steps.filter((step) => !step.ready).map((step) => step.label);
    return missing.length ? `Completa: ${missing.join(", ")}.` : "";
  }, [state]);

  if (loading) {
    return (
      <AdminPageShell width="wide">
        <AdminNav />
        <div className="mt-10 flex min-h-56 items-center justify-center gap-3 text-sm font-bold text-slate-600" role="status">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando facturación…
        </div>
      </AdminPageShell>
    );
  }

  if (!state || !draft) {
    return (
      <AdminPageShell width="wide">
        <AdminNav />
        <div className="mt-8">
          <EmptyState
            title="No pudimos cargar facturación"
            description={error || "La información no está disponible."}
            action={<button type="button" onClick={() => void load()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"><RefreshCcw className="mr-2 inline h-4 w-4" />Reintentar</button>}
          />
        </div>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell width="wide">
      <AdminNav />
      <AdminPageHeader
        eyebrow="Tributario"
        title="Facturación electrónica"
        description={`Estado del negocio: ${state.status.label}.`}
        actions={
          <button type="button" onClick={() => state.status.missingSteps ? setEditingTax(true) : setManualOpen(true)} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">
            {state.status.missingSteps ? "Completar activación" : "Emitir manualmente"}
          </button>
        }
      />

      {error ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">
          <span><AlertCircle className="mr-2 inline h-4 w-4" />{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-red-300 px-3 py-1.5">Reintentar</button>
        </div>
      ) : null}

      <DeclarationReadinessCard state={state.declaration} />

      <AdminSectionCard className="mt-5" title="Autorización SII" description="Separada de la declaración, CAF y activación técnica; sólo platform admin puede reconciliar evidencia.">
        <AuthorizationEvidencePanel />
      </AdminSectionCard>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <AdminSectionCard
          title="Estado de activación"
          description="Cinco controles claros antes de emitir documentos tributarios."
          actions={<StatusBadge label={state.status.label} tone={activationTone} />}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {state.steps.map((step) => (
              <div key={step.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-start gap-2">
                  {step.ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                  <div><div className="text-sm font-black text-slate-900">{step.label}</div><p className="mt-1 text-xs leading-5 text-slate-600">{step.detail}</p></div>
                </div>
                {!step.ready ? <button type="button" onClick={() => step.key === "tax" ? setEditingTax(true) : state.technicalAccess ? setAdvancedOpen(true) : undefined} className="mt-2 text-xs font-black text-blue-700">{step.action}</button> : null}
              </div>
            ))}
          </div>
          {state.status.blockingReason ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{state.status.blockingReason}</p> : null}
        </AdminSectionCard>

        <AdminSectionCard title="Emisión automática" description="Define qué debe ocurrir después de un pago verificado.">
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4">
            <span><span className="block text-sm font-black">Emitir al confirmarse un pago</span><span className="mt-1 block text-xs text-slate-600">El webhook sólo encola; un worker separado procesa.</span></span>
            <input
              type="checkbox"
              checked={automaticConfigured}
              onChange={(event) => setDraft({ ...draft, policy: { ...draft.policy, issuanceMode: event.target.checked ? "automatic_on_verified_payment" : "manual" } })}
              className="h-5 w-5 accent-slate-900"
              aria-describedby="automatic-gate"
            />
          </label>
          <p id="automatic-gate" className="mt-2 text-xs font-bold text-amber-800">{automaticGateReason || (state.policy.effectiveAutomatic ? "Automatización activa." : "Configuración guardada; todavía no activa.")}</p>
          <label className="mt-4 grid gap-1.5 text-sm font-bold">
            Documento para consumidor final
            <select value={draft.policy.consumerDocumentType} onChange={(event) => setDraft({ ...draft, policy: { ...draft.policy, consumerDocumentType: event.target.value as BillingState["policy"]["consumerDocumentType"] } })} className="h-11 rounded-xl border border-slate-200 bg-white px-3">
              <option value="unsupported">No disponible</option>
              <option value="39">Boleta afecta 39 — soporte productivo pendiente</option>
              <option value="41">Boleta exenta 41 — soporte productivo pendiente</option>
            </select>
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.policy.invoiceOnRequest} onChange={(event) => setDraft({ ...draft, policy: { ...draft.policy, invoiceOnRequest: event.target.checked } })} className="h-4 w-4" />Factura cuando el cliente la solicite</label>
          <label className="mt-3 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.policy.autoEmailDelivery} onChange={(event) => setDraft({ ...draft, policy: { ...draft.policy, autoEmailDelivery: event.target.checked } })} className="h-4 w-4" />Enviar por email al alcanzar un estado entregable</label>
          <button type="button" onClick={() => void save()} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Guardando…" : "Guardar política"}</button>
        </AdminSectionCard>
      </div>

      <AdminSectionCard className="mt-5" title="Datos tributarios" description="Identidad fiscal utilizada únicamente por este negocio." actions={<button type="button" onClick={() => setEditingTax((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"><Pencil className="h-4 w-4" />{editingTax ? "Cerrar" : "Editar"}</button>}>
        {!editingTax ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[ ["Razón social", state.tax.legalName], ["RUT", state.tax.taxId], ["Giro", state.tax.businessActivity], ["Dirección", [state.tax.address, state.tax.commune, state.tax.city].filter(Boolean).join(", ")] ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-bold uppercase text-slate-500">{label}</dt><dd className="mt-1 font-black text-slate-900">{value || "Pendiente"}</dd></div>)}
          </dl>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Razón social" value={draft.tax.legalName} onChange={(value) => setDraft({ ...draft, tax: { ...draft.tax, legalName: value } })} />
            <Field label="RUT" value={draft.tax.taxId} onChange={(value) => setDraft({ ...draft, tax: { ...draft.tax, taxId: value } })} />
            <Field label="Giro" value={draft.tax.businessActivity} onChange={(value) => setDraft({ ...draft, tax: { ...draft.tax, businessActivity: value } })} />
            <Field label="Dirección" value={draft.tax.address} onChange={(value) => setDraft({ ...draft, tax: { ...draft.tax, address: value } })} />
            <Field label="Comuna" value={draft.tax.commune} onChange={(value) => setDraft({ ...draft, tax: { ...draft.tax, commune: value } })} />
            <Field label="Ciudad" value={draft.tax.city} onChange={(value) => setDraft({ ...draft, tax: { ...draft.tax, city: value } })} />
            <Field label="Email tributario" type="email" value={draft.tax.email} onChange={(value) => setDraft({ ...draft, tax: { ...draft.tax, email: value } })} />
            <label className="grid gap-1.5 text-sm font-bold">Tratamiento tributario<select value={draft.tax.taxTreatment} onChange={(event) => setDraft({ ...draft, tax: { ...draft.tax, taxTreatment: event.target.value as BillingState["tax"]["taxTreatment"] } })} className="h-11 rounded-xl border border-slate-200 bg-white px-3"><option value="unconfigured">Sin configurar</option><option value="affected">Afecto</option><option value="exempt">Exento</option><option value="mixed">Mixto</option></select></label>
            <div className="flex items-end"><button type="button" onClick={() => void save()} disabled={saving} className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-black text-white">Guardar datos</button></div>
          </div>
        )}
      </AdminSectionCard>

      <AdminSectionCard className="mt-5" title="Documentos recientes" description="Sólo documentos e intenciones pertenecientes al tenant autenticado.">
        {state.documents.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500">{["Tipo", "Folio", "Cliente", "Monto", "Estado", "Fecha", "Acciones"].map((value) => <th key={value} className="px-3 py-2">{value}</th>)}</tr></thead><tbody>{state.documents.map((document) => <tr key={document.id} className="border-b border-slate-100"><td className="px-3 py-3 font-bold">{documentLabel(document.type)}</td><td className="px-3 py-3">{document.folio ?? "—"}</td><td className="px-3 py-3">{document.customer}</td><td className="px-3 py-3 font-bold">{money(document.amount)}</td><td className="px-3 py-3"><StatusBadge label={document.status} tone={document.status === "BLOCKED" ? "amber" : document.status === "ACCEPTED" ? "green" : "blue"} /></td><td className="px-3 py-3">{dateLabel(document.date)}</td><td className="px-3 py-3"><div className="flex gap-2">{document.productionDocumentId ? <DteDocumentActions intentId={document.id} productionDocumentId={document.productionDocumentId} canDownload={document.canDownload} canEmail={document.canEmail} /> : <span className="text-xs text-slate-400">Sin artefactos</span>}{document.canCreateNote ? <DteNoteActions intentId={document.id} originalAmount={document.amount} onCreated={() => void load()} /> : null}</div></td></tr>)}</tbody></table></div>
        ) : <EmptyState title="Aún no hay documentos" description="Las emisiones e intenciones de este negocio aparecerán aquí." />}
      </AdminSectionCard>

      <AdminSectionCard className="mt-5" title="Emitir manualmente" description="Acción secundaria y auditada; nunca usa montos enviados por el navegador." actions={<button type="button" onClick={() => setManualOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"><ReceiptText className="h-4 w-4" />{manualOpen ? "Cerrar" : "Nueva emisión"}</button>}>
        {manualOpen ? <ManualIssuanceForm onCreated={() => void load()} /> : null}
      </AdminSectionCard>

      {state.technicalAccess ? (
        <AdminSectionCard className="mt-5" title="Activación legal" description="Única acción controlada, transaccional y reversible por tipo de documento.">
          <LegalActivationControl />
        </AdminSectionCard>
      ) : null}

      {state.technicalAccess ? (
        <AdminSectionCard className="mt-5" title="Modo técnico avanzado" description="XML, XSD, XMLDSig, Track ID, trazas, runbook, laboratorio y diagnóstico para personal autorizado." actions={<button type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"><SlidersHorizontal className="h-4 w-4" />{advancedOpen ? "Contraer" : "Abrir"}<ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} /></button>}>
          {advancedOpen ? <div className="mt-3 border-t border-slate-200 pt-4"><AdvancedBillingTechnicalPanel /></div> : <p className="text-sm text-slate-600">Colapsado por defecto. No se muestran detalles técnicos en la vista ejecutiva.</p>}
        </AdminSectionCard>
      ) : null}
    </AdminPageShell>
  );
}
