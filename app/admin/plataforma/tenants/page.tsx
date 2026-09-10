"use client";

import { useCallback, useEffect, useState } from "react";

import AdminNav from "@/components/admin/AdminNav";
import { AdminPageHeader, AdminPageShell, AdminSectionCard } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/api/adminFetch";

type TaxDocumentMode = "unconfigured" | "citaya_dte" | "external_bhe";

type FeatureProfile = {
  tenant_id: string;
  appointments_enabled: boolean;
  appointment_communications_enabled: boolean;
  external_communications_enabled: boolean;
  campaigns_enabled: boolean;
  payments_enabled: boolean;
  dte_enabled: boolean;
  tax_document_mode: TaxDocumentMode;
  tax_mode_verified_at?: string | null;
  tax_mode_evidence_reference?: string | null;
  updated_at?: string | null;
};

type FeatureDraft = {
  appointmentsEnabled: boolean;
  appointmentCommunicationsEnabled: boolean;
  externalCommunicationsEnabled: boolean;
  campaignsEnabled: boolean;
  paymentsEnabled: boolean;
  dteEnabled: boolean;
  taxDocumentMode: TaxDocumentMode;
  taxModeEvidenceReference: string;
};

type TenantRow = {
  id: string; name: string; slug: string; lifecycle_status: "active" | "archived";
  operational_mode: "unclassified" | "demo" | "live" | "internal";
  operational_mode_changed_at?: string | null; operational_mode_change_reason?: string | null;
  capabilities: Record<string, boolean | string>;
  featureProfile: FeatureProfile | null;
  liveReadiness: Record<string, boolean | string>;
  taxDocumentReadiness: Record<string, boolean | string>;
  selfIssuerAuthority: {
    status: "none" | "active" | "revoked" | "invalidated";
    valid: boolean; evidenceExists?: boolean; revoked?: boolean;
    rutMatches?: boolean; identityMatches?: boolean;
  };
};

function featureDraft(profile: FeatureProfile | null): FeatureDraft {
  return {
    appointmentsEnabled: profile?.appointments_enabled === true,
    appointmentCommunicationsEnabled: profile?.appointment_communications_enabled === true,
    externalCommunicationsEnabled: profile?.external_communications_enabled === true,
    campaignsEnabled: profile?.campaigns_enabled === true,
    paymentsEnabled: profile?.payments_enabled === true,
    dteEnabled: profile?.dte_enabled === true,
    taxDocumentMode: profile?.tax_document_mode ?? "unconfigured",
    taxModeEvidenceReference: profile?.tax_mode_evidence_reference ?? "",
  };
}

const FEATURE_LABELS: Array<[keyof Pick<FeatureDraft,
  "appointmentsEnabled" |
  "appointmentCommunicationsEnabled" |
  "externalCommunicationsEnabled" |
  "campaignsEnabled" |
  "paymentsEnabled" |
  "dteEnabled"
>, string]> = [
  ["appointmentsEnabled", "Agenda real"],
  ["appointmentCommunicationsEnabled", "Comunicaciones de citas"],
  ["externalCommunicationsEnabled", "Emails/comunicaciones externas"],
  ["campaignsEnabled", "Campañas"],
  ["paymentsEnabled", "Pagos Citaya"],
  ["dteEnabled", "DTE Citaya"],
];

export default function PlatformTenantModesPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Record<string, TenantRow["operational_mode"]>>({});
  const [features, setFeatures] = useState<Record<string, FeatureDraft>>({});
  const [administrativeReference, setAdministrativeReference] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const response = await adminFetch("/api/admin/platform/tenants", { cache: "no-store" });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) throw new Error(json?.error ?? "No se pudo cargar");
    const rows = (json.tenants ?? []) as TenantRow[];
    setTenants(rows);
    setMode(Object.fromEntries(rows.map((tenant) => [tenant.id, tenant.operational_mode])));
    setFeatures(Object.fromEntries(rows.map((tenant) => [tenant.id, featureDraft(tenant.featureProfile)])));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((cause) => setMessage(cause instanceof Error ? cause.message : "No se pudo cargar"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const update = async (tenant: TenantRow, action?: "archive") => {
    const selected = mode[tenant.id] ?? tenant.operational_mode;
    const confirmed = action === "archive"
      ? window.confirm("Archivar bloquea operaciones y revoca accesos ordinarios. ¿Continuar?")
      : selected !== "live" || window.confirm("Confirmo que el onboarding legal, los servicios y cada capacidad habilitada fueron revisados para operación live.");
    if (!confirmed) return;
    const response = await adminFetch("/api/admin/platform/tenants", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.id, operationalMode: selected, action, reason: reason[tenant.id] ?? "", confirmed: true }),
    });
    const json = await response.json().catch(() => null);
    setMessage(response.ok && json?.ok ? "Clasificación actualizada y auditada" : json?.error ?? "No se pudo actualizar");
    if (response.ok) await refresh();
  };

  const updateFeatures = async (tenant: TenantRow) => {
    const draft = features[tenant.id] ?? featureDraft(tenant.featureProfile);
    if (draft.taxDocumentMode === "external_bhe" && draft.taxModeEvidenceReference.trim().length < 3) {
      setMessage("La BHE externa requiere una referencia de verificación");
      return;
    }
    const confirmed = window.confirm(
      "Las capacidades productivas son independientes. Pagos y DTE permanecerán cerrados si están OFF. ¿Guardar esta configuración?",
    );
    if (!confirmed) return;

    const response = await adminFetch("/api/admin/platform/tenant-features", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.id,
        ...draft,
        reason: reason[tenant.id] ?? "",
      }),
    });
    const json = await response.json().catch(() => null);
    setMessage(response.ok && json?.ok ? "Capacidades actualizadas y auditadas" : json?.error ?? "No se pudieron actualizar las capacidades");
    if (response.ok) await refresh();
  };

  const updateSelfIssuer = async (tenant: TenantRow, action: "registerSelfIssuer" | "revokeSelfIssuer") => {
    const label = action === "registerSelfIssuer" ? "registrar" : "revocar";
    if (!window.confirm(`Esta acción va a ${label} evidencia administrativa append-only. No habilita emisión. ¿Continuar?`)) return;
    const response = await adminFetch("/api/admin/platform/tenants", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.id, action, reason: reason[tenant.id] ?? "",
        administrativeReference: administrativeReference[tenant.id] ?? "", confirmed: true,
      }),
    });
    const json = await response.json().catch(() => null);
    setMessage(response.ok && json?.ok ? "Autoridad de emisor propio actualizada y auditada" : json?.error ?? "No se pudo actualizar");
    if (response.ok) await refresh();
  };

  return (
    <AdminPageShell>
      <AdminNav />
      <AdminPageHeader
        eyebrow="Plataforma"
        title="Modo operativo y capacidades"
        description="Solo platform admin. Live significa operación real; agenda, campañas, pagos y DTE se habilitan de forma independiente y fail-closed."
      />
      {message ? <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-sm font-bold">{message}</div> : null}
      <div className="mt-5 grid gap-4">
        {tenants.map((tenant) => {
          const draft = features[tenant.id] ?? featureDraft(tenant.featureProfile);
          return (
            <AdminSectionCard key={tenant.id} title={`${tenant.name} · ${tenant.slug}`} description={`Lifecycle: ${tenant.lifecycle_status} · Modo actual: ${tenant.operational_mode}`}>
              <div className="grid gap-3 lg:grid-cols-[180px_1fr_auto]">
                <select className="rounded-xl border px-3 py-2" value={mode[tenant.id] ?? tenant.operational_mode}
                  disabled={tenant.lifecycle_status === "archived"}
                  onChange={(event) => setMode((current) => ({ ...current, [tenant.id]: event.target.value as TenantRow["operational_mode"] }))}>
                  <option value="unclassified">Sin clasificar</option><option value="demo">Demo</option>
                  <option value="live">Live</option><option value="internal">Internal</option>
                </select>
                <input className="rounded-xl border px-3 py-2" placeholder="Motivo contractual/operativo (mínimo 10 caracteres)"
                  value={reason[tenant.id] ?? ""} onChange={(event) => setReason((current) => ({ ...current, [tenant.id]: event.target.value }))} />
                <div className="flex gap-2"><Button onClick={() => void update(tenant)}>Clasificar</Button>
                  {tenant.lifecycle_status === "active" ? <Button variant="destructive" onClick={() => void update(tenant, "archive")}>Archivar</Button> : null}</div>
              </div>

              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                <strong>Checklist live:</strong> {tenant.liveReadiness?.ready === true ? "completo" : "incompleto"} ·
                {" "}<strong>Modelo tributario:</strong> {String(tenant.taxDocumentReadiness?.mode ?? "unconfigured")} ·
                {" "}<strong>Gate tributario:</strong> {tenant.taxDocumentReadiness?.ready === true ? "listo" : "pendiente"}.
              </div>

              {tenant.lifecycle_status === "active" ? (
                <div className="mt-3 rounded-xl border border-slate-200 p-4">
                  <div className="text-sm font-black">Capacidades productivas</div>
                  <p className="mt-1 text-xs text-slate-600">
                    Live no activa funciones por sí solo. Cada capacidad queda sujeta además a sus propios gates de seguridad y readiness.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {FEATURE_LABELS.map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 rounded-lg border p-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={draft[key]}
                          onChange={(event) => setFeatures((current) => ({
                            ...current,
                            [tenant.id]: { ...draft, [key]: event.target.checked },
                          }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-[220px_1fr_auto]">
                    <select
                      className="rounded-xl border px-3 py-2 text-sm"
                      value={draft.taxDocumentMode}
                      onChange={(event) => setFeatures((current) => ({
                        ...current,
                        [tenant.id]: {
                          ...draft,
                          taxDocumentMode: event.target.value as TaxDocumentMode,
                          dteEnabled: event.target.value === "citaya_dte" ? draft.dteEnabled : false,
                        },
                      }))}
                    >
                      <option value="unconfigured">Tributación sin configurar</option>
                      <option value="external_bhe">BHE externa/manual</option>
                      <option value="citaya_dte">DTE emitido por Citaya</option>
                    </select>
                    <input
                      className="rounded-xl border px-3 py-2 text-sm"
                      placeholder="Referencia de verificación tributaria (obligatoria para BHE externa)"
                      value={draft.taxModeEvidenceReference}
                      onChange={(event) => setFeatures((current) => ({
                        ...current,
                        [tenant.id]: { ...draft, taxModeEvidenceReference: event.target.value },
                      }))}
                    />
                    <Button onClick={() => void updateFeatures(tenant)}>Guardar capacidades</Button>
                  </div>
                </div>
              ) : null}

              {tenant.lifecycle_status === "active" && Boolean(tenant.selfIssuerAuthority)
                && (tenant.operational_mode === "internal" || tenant.selfIssuerAuthority.evidenceExists) ? <div className="mt-3 rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-black">Emisor propio DTE</div>
                <div className="mt-1 text-xs text-slate-600">
                  Estado: {tenant.selfIssuerAuthority.status}. RUT coincidente: {tenant.selfIssuerAuthority.rutMatches ? "sí" : "no"}. Esta evidencia aplica al flujo DTE y no a BHE externa.
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto]">
                  <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Referencia administrativa verificable"
                    value={administrativeReference[tenant.id] ?? ""} onChange={(event) => setAdministrativeReference((current) => ({ ...current, [tenant.id]: event.target.value }))} />
                  {tenant.selfIssuerAuthority.evidenceExists && !tenant.selfIssuerAuthority.revoked
                    ? <Button variant="destructive" onClick={() => void updateSelfIssuer(tenant, "revokeSelfIssuer")}>Revocar emisor propio</Button>
                    : tenant.operational_mode === "internal"
                      ? <Button onClick={() => void updateSelfIssuer(tenant, "registerSelfIssuer")}>Registrar emisor propio</Button>
                      : null}
                </div>
              </div> : null}
            </AdminSectionCard>
          );
        })}
      </div>
    </AdminPageShell>
  );
}
