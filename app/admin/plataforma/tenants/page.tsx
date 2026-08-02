"use client";

import { useCallback, useEffect, useState } from "react";

import AdminNav from "@/components/admin/AdminNav";
import { AdminPageHeader, AdminPageShell, AdminSectionCard } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/api/adminFetch";

type TenantRow = {
  id: string; name: string; slug: string; lifecycle_status: "active" | "archived";
  operational_mode: "unclassified" | "demo" | "live" | "internal";
  operational_mode_changed_at?: string | null; operational_mode_change_reason?: string | null;
  capabilities: Record<string, boolean | string>;
  liveReadiness: Record<string, boolean>;
};

export default function PlatformTenantModesPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Record<string, TenantRow["operational_mode"]>>({});
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const response = await adminFetch("/api/admin/platform/tenants", { cache: "no-store" });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) throw new Error(json?.error ?? "No se pudo cargar");
    setTenants(json.tenants ?? []);
    setMode(Object.fromEntries((json.tenants ?? []).map((tenant: TenantRow) => [tenant.id, tenant.operational_mode])));
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
      : selected !== "live" || window.confirm("Confirmo que identidad, documentos legales, privacidad, servicios, pagos y tributación fueron revisados para operación live.");
    if (!confirmed) return;
    const response = await adminFetch("/api/admin/platform/tenants", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.id, operationalMode: selected, action, reason: reason[tenant.id] ?? "", confirmed: true }),
    });
    const json = await response.json().catch(() => null);
    setMessage(response.ok && json?.ok ? "Clasificación actualizada y auditada" : json?.error ?? "No se pudo actualizar");
    if (response.ok) await refresh();
  };

  return (
    <AdminPageShell>
      <AdminNav />
      <AdminPageHeader eyebrow="Plataforma" title="Modo operativo de tenants" description="Solo platform admin. El lifecycle contractual y el modo operativo son controles independientes." />
      {message ? <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-sm font-bold">{message}</div> : null}
      <div className="mt-5 grid gap-4">
        {tenants.map((tenant) => (
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
              <strong>Checklist live:</strong> {tenant.liveReadiness?.ready ? "completo" : "incompleto"}. Cambiar a live falla cerrado si falta cualquier gate.
            </div>
          </AdminSectionCard>
        ))}
      </div>
    </AdminPageShell>
  );
}
