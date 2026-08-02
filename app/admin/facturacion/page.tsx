"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Pencil,
  RefreshCcw,
  Save,
  SlidersHorizontal,
  X,
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
  rawStatus: string;
  terminal: boolean;
  folio: number | null;
  customer: string;
  amount: number;
  status: string;
  date: string;
  blockingReason: string | null;
  canView: boolean;
  canDownloadXml: boolean;
  canDownloadPdf: boolean;
  canQuery: boolean;
  canCreateNote: boolean;
  canEmail: boolean;
};
type BillingView = "summary" | "new" | "documents" | "settings" | "diagnostics";
type DocumentFilter = "current" | "canceled" | "all";
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
    depositTaxDocumentPolicyStatus: "unconfigured" | "reviewed" | "enabled";
    boletaPaymentDocumentModel: "unconfigured" | "always_issue_boleta" | "electronic_payment_voucher_as_boleta";
    boletaModelVerifiedAt: string | null;
    boletaModelVerifiedBy: string | null;
    boletaModelEvidenceReference: string | null;
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
  const [documentsRefreshing, setDocumentsRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingTax, setEditingTax] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeView, setActiveView] = useState<BillingView>("summary");
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>("current");

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
      if (params.has("appointmentId") || params.has("customerId")) {
        setManualOpen(true);
        setActiveView("new");
      }
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

  const refreshDocuments = async () => {
    if (documentsRefreshing) return;
    setDocumentsRefreshing(true);
    try {
      const response = await adminFetch("/api/admin/dte-settings/documents", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "No se pudieron actualizar los documentos.");
      }
      setState((current) => current
        ? { ...current, documents: payload.documents as DocumentRow[] }
        : current);
    } catch (refreshError) {
      setError(billingErrorMessage(refreshError));
    } finally {
      setDocumentsRefreshing(false);
    }
  };

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
        depositTaxDocumentPolicyStatus: draft.policy.depositTaxDocumentPolicyStatus,
        boletaPaymentDocumentModel: draft.policy.boletaPaymentDocumentModel,
        boletaModelEvidenceReference: draft.policy.boletaModelEvidenceReference,
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
  const documentCounts = useMemo(() => {
    const canceled = state?.documents.filter((document) =>
      document.rawStatus === "CANCELED"
    ).length ?? 0;
    const drafts = state?.documents.filter((document) =>
      ["DRAFT", "VALIDATED"].includes(document.rawStatus)
    ).length ?? 0;
    const review = state?.documents.filter((document) =>
      document.rawStatus === "REVIEW_REQUIRED"
    ).length ?? 0;
    const issued = state?.documents.filter((document) =>
      Boolean(document.productionDocumentId) && document.rawStatus !== "CANCELED"
    ).length ?? 0;
    return { issued, drafts, review, canceled };
  }, [state?.documents]);
  const filteredDocuments = useMemo(() => {
    const documents = state?.documents ?? [];
    if (documentFilter === "canceled") {
      return documents.filter((document) => document.rawStatus === "CANCELED");
    }
    if (documentFilter === "current") {
      return documents.filter((document) => document.rawStatus !== "CANCELED");
    }
    return documents;
  }, [documentFilter, state?.documents]);
  const openInvoiceEditor = () => {
    setManualOpen(true);
    setActiveView("new");
  };

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
        description="Crea borradores, revisa documentos y administra la configuración tributaria."
        actions={
          ["summary", "documents"].includes(activeView) && !manualOpen ? (
            <button
              type="button"
              onClick={openInvoiceEditor}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
            >
              Nueva factura
            </button>
          ) : null
        }
      />

      {error ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">
          <span><AlertCircle className="mr-2 inline h-4 w-4" />{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-red-300 px-3 py-1.5">Reintentar</button>
        </div>
      ) : null}

      <nav className="mt-5 flex flex-wrap gap-2" aria-label="Secciones de facturación">
        {[
          ["summary", "Resumen"],
          ["new", "Nueva factura"],
          ["documents", "Documentos"],
          ["settings", "Configuración tributaria"],
          ["diagnostics", "Diagnóstico"],
        ].filter(([view]) => view !== "diagnostics" || state.technicalAccess)
          .map(([view, label]) => (
          <button
            type="button"
            key={view}
            onClick={() => {
              setActiveView(view as BillingView);
              setManualOpen(view === "new");
            }}
            aria-current={activeView === view ? "page" : undefined}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-black ${
              activeView === view
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeView === "new" ? (
        <div id="nueva-factura">
        <AdminSectionCard
          className="mt-5"
          title="Nueva factura"
          description="Documento tipo 33 con uno o varios servicios. Los precios se ingresan netos y el IVA se muestra por separado."
          actions={
            manualOpen ? (
              <button
                type="button"
                onClick={() => {
                  setManualOpen(false);
                  setActiveView("summary");
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"
              >
                <X className="h-4 w-4" />
                Cerrar editor
              </button>
            ) : null
          }
        >
          {manualOpen ? (
            <ManualIssuanceForm
              onCreated={() => void refreshDocuments()}
              onClose={() => {
                setManualOpen(false);
                setActiveView("summary");
              }}
            />
          ) : null}
        </AdminSectionCard>
        </div>
      ) : null}

      {activeView === "summary" ? (
      <div id="resumen">
      <AdminSectionCard className="mt-5" title="Resumen" description="Lo necesario para operar facturación hoy." actions={<StatusBadge label={state.status.label} tone={activationTone} />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Emitidos", documentCounts.issued, "bg-emerald-50 text-emerald-950"],
            ["Borradores", documentCounts.drafts, "bg-blue-50 text-blue-950"],
            ["Requieren revisión", documentCounts.review, "bg-amber-50 text-amber-950"],
            ["Cancelados", documentCounts.canceled, "bg-slate-100 text-slate-950"],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className={`rounded-2xl p-4 ${tone}`}>
              <p className="text-xs font-bold uppercase">{label}</p>
              <p className="mt-1 text-2xl font-black">{value}</p>
            </div>
          ))}
        </div>
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
              disabled
              className="h-5 w-5 accent-slate-900"
              aria-describedby="automatic-gate"
            />
          </label>
          <p id="automatic-gate" className="mt-2 text-xs font-bold text-amber-800">{automaticGateReason || (state.policy.effectiveAutomatic ? "Automatización activa." : "Permanece desactivada. Los pagos confirmados quedan listos para revisión.")}</p>
          <label className="mt-3 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.policy.invoiceOnRequest} onChange={(event) => setDraft({ ...draft, policy: { ...draft.policy, invoiceOnRequest: event.target.checked } })} className="h-4 w-4" />Factura cuando el cliente la solicite</label>
          <label className="mt-3 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.policy.autoEmailDelivery} onChange={(event) => setDraft({ ...draft, policy: { ...draft.policy, autoEmailDelivery: event.target.checked } })} className="h-4 w-4" />Enviar por email al alcanzar un estado entregable</label>
          <button type="button" onClick={() => void save()} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Guardando…" : "Guardar política"}</button>
        </AdminSectionCard>
      </div>
      </div>
      ) : null}

      {activeView === "settings" ? (
      <div id="configuracion">
      <AdminSectionCard className="mt-5" title="Configuración tributaria" description="Fuente maestra de la identidad fiscal utilizada únicamente por este negocio." actions={<button type="button" onClick={() => setEditingTax((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"><Pencil className="h-4 w-4" />{editingTax ? "Cerrar" : "Editar"}</button>}>
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
      <AdminSectionCard className="mt-5" title="Modelo declarado de boleta y voucher" description="Debe reflejar lo declarado realmente por el contribuyente ante el SII. No se infiere desde el proveedor de pago.">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-bold">Modelo declarado
            <select value={draft.policy.boletaPaymentDocumentModel} onChange={(event) => setDraft({ ...draft, policy: { ...draft.policy, boletaPaymentDocumentModel: event.target.value as BillingState["policy"]["boletaPaymentDocumentModel"] } })} className="h-11 rounded-xl border border-slate-200 bg-white px-3">
              <option value="unconfigured">Sin configurar</option>
              <option value="always_issue_boleta">Siempre emitir boleta (recomendado)</option>
              <option value="electronic_payment_voucher_as_boleta">Voucher electrónico opera como boleta</option>
            </select>
          </label>
          <Field label="Referencia administrativa de verificación" value={draft.policy.boletaModelEvidenceReference ?? ""} onChange={(value) => setDraft({ ...draft, policy: { ...draft.policy, boletaModelEvidenceReference: value } })} />
        </div>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
          Citaya recomienda “Siempre emitir boleta”, pero no cambia automáticamente la declaración del contribuyente. Una configuración incorrecta puede duplicar el documento tributario.
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div><dt className="font-bold text-slate-500">Verificado</dt><dd>{state.policy.boletaModelVerifiedAt ? dateLabel(state.policy.boletaModelVerifiedAt) : "Pendiente"}</dd></div>
          <div><dt className="font-bold text-slate-500">Administrador</dt><dd>{state.policy.boletaModelVerifiedBy ?? "Pendiente"}</dd></div>
          <div><dt className="font-bold text-slate-500">Anticipos</dt><dd>{state.policy.depositTaxDocumentPolicyStatus}</dd></div>
        </dl>
        <p className="mt-3 text-sm font-black text-amber-900">El cobro de anticipos todavía requiere configurar su tratamiento tributario.</p>
        <button type="button" onClick={() => void save()} disabled={saving} className="mt-4 inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-50">Guardar modelo declarado</button>
      </AdminSectionCard>
      </div>
      ) : null}

      {activeView === "documents" ? (
      <div id="documentos">
      <AdminSectionCard className="mt-5" title="Documentos" description={documentsRefreshing ? "Actualizando estados en segundo plano…" : "Borradores, documentos en revisión y emisiones del negocio."}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Emitidos", documentCounts.issued],
            ["Borradores", documentCounts.drafts],
            ["Requieren revisión", documentCounts.review],
            ["Cancelados", documentCounts.canceled],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Filtros de documentos">
          {[
            ["current", "Vigentes"],
            ["canceled", `Cancelados (${documentCounts.canceled})`],
            ["all", "Todos"],
          ].map(([filter, label]) => (
            <button
              type="button"
              key={filter}
              onClick={() => setDocumentFilter(filter as DocumentFilter)}
              aria-pressed={documentFilter === filter}
              className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                documentFilter === filter
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {filteredDocuments.length ? (
          <div className="mt-4" aria-live="polite">
            <div className="grid gap-3 md:hidden">
              {filteredDocuments.map((document) => (
                <article key={document.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-950">{documentLabel(document.type)}</p>
                      <p className="text-xs text-slate-500">
                        Folio {document.folio ?? "pendiente"} · {dateLabel(document.date)}
                      </p>
                    </div>
                    <StatusBadge
                      label={document.status}
                      tone={document.rawStatus === "BLOCKED"
                        ? "amber"
                        : document.status.startsWith("Aceptado")
                          ? "green"
                          : "blue"}
                    />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-slate-500">Cliente</dt><dd className="font-bold">{document.customer}</dd></div>
                    <div><dt className="text-xs text-slate-500">Total IVA incluido</dt><dd className="font-black">{money(document.amount)}</dd></div>
                  </dl>
                  {document.blockingReason ? (
                    <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
                      {document.blockingReason}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {document.productionDocumentId ? (
                      <DteDocumentActions intentId={document.id} productionDocumentId={document.productionDocumentId} canViewTrackId={document.canView} canDownloadXml={document.canDownloadXml} canDownloadPdf={document.canDownloadPdf} canEmail={document.canEmail} />
                    ) : <span className="text-xs text-slate-400">Sin artefactos</span>}
                    {document.canCreateNote ? <DteNoteActions intentId={document.id} originalAmount={document.amount} onCreated={() => void refreshDocuments()} /> : null}
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b text-xs uppercase text-slate-500">{["Tipo", "Folio", "Cliente", "Total IVA incluido", "Estado", "Fecha", "Acciones"].map((value) => <th key={value} className="px-3 py-2">{value}</th>)}</tr></thead>
                <tbody>{filteredDocuments.map((document) => (
                  <tr key={document.id} className="border-b border-slate-100">
                    <td className="px-3 py-3 font-bold">{documentLabel(document.type)}</td>
                    <td className="px-3 py-3">{document.folio ?? "—"}</td>
                    <td className="px-3 py-3">{document.customer}</td>
                    <td className="px-3 py-3 font-bold">{money(document.amount)}</td>
                    <td className="px-3 py-3">
                      <StatusBadge label={document.status} tone={document.rawStatus === "BLOCKED" ? "amber" : document.status.startsWith("Aceptado") ? "green" : "blue"} />
                      {document.blockingReason ? <p className="mt-1 max-w-xs text-xs font-bold leading-5 text-amber-800">{document.blockingReason}</p> : null}
                    </td>
                    <td className="px-3 py-3">{dateLabel(document.date)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        {document.productionDocumentId ? <DteDocumentActions intentId={document.id} productionDocumentId={document.productionDocumentId} canViewTrackId={document.canView} canDownloadXml={document.canDownloadXml} canDownloadPdf={document.canDownloadPdf} canEmail={document.canEmail} /> : <span className="text-xs text-slate-400">Sin artefactos</span>}
                        {document.canCreateNote ? <DteNoteActions intentId={document.id} originalAmount={document.amount} onCreated={() => void refreshDocuments()} /> : null}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ) : <EmptyState title="No hay documentos en este filtro" description="Selecciona otro filtro o crea una nueva factura." />}
      </AdminSectionCard>
      </div>
      ) : null}

      {activeView === "diagnostics" && state.technicalAccess ? (
        <div id="diagnostico">
        <AdminSectionCard className="mt-5" title="Diagnóstico y detalles técnicos" description="Autorización, activación legal, XML, XSD, firma, identificadores y trazas para soporte autorizado." actions={<button type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"><SlidersHorizontal className="h-4 w-4" />{advancedOpen ? "Cerrar detalles" : "Abrir detalles"}<ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} /></button>}>
          {advancedOpen ? <div className="grid gap-5 border-t border-slate-200 pt-4">
            <DeclarationReadinessCard state={state.declaration} />
            <section><h3 className="mb-3 font-black">Autorización SII</h3><AuthorizationEvidencePanel /></section>
            <section><h3 className="mb-3 font-black">Activación legal</h3><LegalActivationControl /></section>
            <AdvancedBillingTechnicalPanel />
          </div> : <p className="text-sm text-slate-600">Cerrado por defecto. La operación diaria no muestra hashes, firma, XSD ni trazas.</p>}
        </AdminSectionCard>
        </div>
      ) : null}
    </AdminPageShell>
  );
}
