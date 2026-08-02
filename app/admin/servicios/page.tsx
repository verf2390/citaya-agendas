"use client";

import { adminFetch } from "@/lib/api/adminFetch";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminPageShell,
  EmptyState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { toast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { resolveTenantFromHostname } from "@/lib/client/tenant-resolution";

type ServiceRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  public_description: string | null;
  internal_description: string | null;
  tax_description: string | null;
  tax_description_review_status: "pending" | "approved" | "rejected";
  contains_potentially_sensitive_information: boolean;
  payment_policy: "no_advance" | "deposit" | "full_payment";
  deposit_type: "fixed_amount" | "percentage" | null;
  deposit_value: number | null;
  provisional_expiry_minutes: number;
  payment_configuration_complete: boolean;
  duration_min: number | null;
  price: number | null;
  currency: string | null;
  is_active: boolean | null;
  created_at?: string | null;
};

const EMPTY_SERVICE = {
  id: "",
  name: "",
  description: "",
  public_description: "",
  internal_description: "",
  tax_description: "",
  tax_description_approved: false,
  contains_potentially_sensitive_information: false,
  payment_policy: "no_advance" as "no_advance" | "deposit" | "full_payment",
  deposit_type: null as "fixed_amount" | "percentage" | null,
  deposit_value: 0,
  provisional_expiry_minutes: 30,
  duration_min: 60,
  price: 0,
  currency: "CLP",
  is_active: true,
};

export default function ServiciosPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [form, setForm] = useState(EMPTY_SERVICE);

  const getAuthToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  };

  const formatPrice = (price: number | null, currency: string | null) => {
    if (price === null || price === undefined || !Number.isFinite(Number(price))) {
      return "Precio no definido";
    }

    return `${Number(price).toLocaleString("es-CL", {
      style: "currency",
      currency: currency || "CLP",
      maximumFractionDigits: 0,
    })} ${currency || "CLP"}`;
  };

  const formatDuration = (duration: number | null) => {
    if (!duration || !Number.isFinite(Number(duration))) {
      return "Duración no definida";
    }

    return `${duration} min`;
  };

  useEffect(() => {
    const run = async () => {
      const result = await resolveTenantFromHostname(window.location.host);
      if (!result.ok) {
        setTenantSlug(result.slug ?? "");
        setTenantError(result.message);
        setLoading(false);
        return;
      }
      setTenantSlug(result.slug);
      setTenantId(result.tenant.id);
    };

    void run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!tenantId || tenantError) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?redirectTo=${encodeURIComponent("/admin/servicios")}`);
        return;
      }
      setAuthChecked(true);
    };
    void run();
  }, [router, tenantId, tenantError]);

  const loadServices = async () => {
    if (!tenantId) return;
    setLoading(true);
    setSaveError("");

    const token = await getAuthToken();
    if (!token) {
      setSaveError("Sesión expirada. Vuelve a iniciar sesión.");
      setServices([]);
      setLoading(false);
      return;
    }

    const res = await adminFetch(`/api/admin/services?tenantId=${encodeURIComponent(tenantId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !Array.isArray(json?.services)) {
      setSaveError("No se pudieron cargar los servicios. Inténtalo nuevamente.");
      setServices([]);
    } else {
      setServices(json.services as ServiceRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecked || !tenantId) return;
    void loadServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, tenantId]);

  const resetForm = () => {
    setForm(EMPTY_SERVICE);
    setSaveError("");
  };

  const editService = (service: ServiceRow) => {
    setForm({
      id: service.id,
      name: service.name ?? "",
      description: service.description ?? "",
      public_description: service.public_description ?? "",
      internal_description: service.internal_description ?? "",
      tax_description: service.tax_description ?? "",
      tax_description_approved: service.tax_description_review_status === "approved",
      contains_potentially_sensitive_information: service.contains_potentially_sensitive_information,
      payment_policy: service.payment_policy ?? "no_advance",
      deposit_type: service.deposit_type,
      deposit_value: service.deposit_type === "percentage"
        ? Number(service.deposit_value ?? 0) / 100
        : Number(service.deposit_value ?? 0),
      provisional_expiry_minutes: service.provisional_expiry_minutes ?? 30,
      duration_min: service.duration_min ?? 60,
      price: service.price ?? 0,
      currency: service.currency ?? "CLP",
      is_active: service.is_active ?? true,
    });
  };

  const saveService = async () => {
    const name = form.name.trim();
    if (!name) {
      toast({ title: "El nombre del servicio es obligatorio", variant: "destructive" });
      return;
    }

    setSaving(true);
    setSaveError("");
    const isEditing = Boolean(form.id);
    const payload = {
      id: form.id || undefined,
      tenantId,
      name,
      description: form.description.trim() || null,
      publicDescription: form.public_description.trim() || null,
      internalDescription: form.internal_description.trim() || null,
      taxDescription: form.tax_description.trim() || null,
      taxDescriptionApproved: form.tax_description_approved,
      containsPotentiallySensitiveInformation: form.contains_potentially_sensitive_information,
      paymentPolicy: form.payment_policy,
      depositType: form.payment_policy === "deposit" ? form.deposit_type : null,
      depositValue: form.payment_policy === "deposit"
        ? form.deposit_type === "percentage"
          ? Math.round(Number(form.deposit_value) * 100)
          : Math.round(Number(form.deposit_value))
        : null,
      provisionalExpiryMinutes: Math.round(Number(form.provisional_expiry_minutes)),
      duration: Number(form.duration_min) || 60,
      price: Number(form.price) || 0,
      currency: form.currency.trim() || "CLP",
      is_active: !!form.is_active,
    };
    const token = await getAuthToken();

    if (!token) {
      setSaving(false);
      setSaveError("Sesión expirada. Vuelve a iniciar sesión.");
      return;
    }

    const res = await adminFetch("/api/admin/services", {
      method: isEditing ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);

    setSaving(false);

    if (!res.ok || !json?.ok) {
      const message = json?.error ?? "No se pudo guardar el servicio.";
      console.error("[admin/servicios] save error:", json);
      setSaveError(message);
      toast({ title: "No se pudo guardar el servicio", description: message, variant: "destructive" });
      return;
    }

    resetForm();
    await loadServices();
  };

  const toggleServiceActive = async (service: ServiceRow) => {
    const currentActive = service.is_active ?? true;
    const nextActive = !currentActive;
    const confirmed = window.confirm(
      nextActive
        ? `¿Activar el servicio "${service.name}"?`
        : `¿Desactivar el servicio "${service.name}"? No se borrará el historial ni las reservas asociadas.`,
    );

    if (!confirmed) return;

    setSaving(true);
    setSaveError("");
    const token = await getAuthToken();

    if (!token) {
      setSaving(false);
      setSaveError("Sesión expirada. Vuelve a iniciar sesión.");
      return;
    }

    const res = await adminFetch("/api/admin/services", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: service.id,
        tenantId,
        is_active: nextActive,
      }),
    });
    const json = await res.json().catch(() => null);

    setSaving(false);

    if (!res.ok || !json?.ok) {
      const message = json?.error ?? "No se pudo cambiar el estado del servicio.";
      console.error("[admin/servicios] active toggle error:", json);
      setSaveError(message);
      toast({ title: "No se pudo cambiar el estado del servicio", description: message, variant: "destructive" });
      return;
    }

    if (form.id === service.id) {
      setForm((prev) => ({ ...prev, is_active: nextActive }));
    }
    await loadServices();
  };

  if (tenantError) {
    return (
      <main className="p-6 text-sm text-red-700">
        <p>{tenantError}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-xl border px-3 py-2 font-bold">
          Reintentar
        </button>
      </main>
    );
  }

  return (
    <AdminPageShell width="normal">
        <AdminNav />
        <AdminPageHeader
          eyebrow="Catalogo"
          title="Servicios"
          description={`Precios, duracion y disponibilidad comercial para ${tenantSlug || "..."}.`}
        />

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <AdminKpiCard label="Total servicios" value={services.length} />
          <AdminKpiCard label="Activos" value={services.filter((s) => s.is_active ?? true).length} tone="green" />
          <AdminKpiCard label="Inactivos" value={services.filter((s) => !(s.is_active ?? true)).length} />
        </div>

        <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <section className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="font-black text-slate-900">{form.id ? "Editar servicio" : "Crear servicio"}</h2>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm font-semibold">
                Nombre
                <input className="min-w-0 rounded-xl border px-3 py-2" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Descripción pública
                <textarea className="min-h-20 min-w-0 rounded-xl border px-3 py-2" value={form.public_description} onChange={(e) => setForm((p) => ({ ...p, public_description: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Descripción interna (nunca se envía al SII)
                <textarea className="min-h-20 min-w-0 rounded-xl border px-3 py-2" value={form.internal_description} onChange={(e) => setForm((p) => ({ ...p, internal_description: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Descripción tributaria mínima
                <textarea className="min-h-20 min-w-0 rounded-xl border px-3 py-2" value={form.tax_description} onChange={(e) => setForm((p) => ({ ...p, tax_description: e.target.value, tax_description_approved: false }))} />
              </label>
              <label className="flex items-start gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.contains_potentially_sensitive_information} onChange={(e) => setForm((p) => ({ ...p, contains_potentially_sensitive_information: e.target.checked, tax_description_approved: false }))} />
                El servicio puede involucrar información sensible
              </label>
              <label className="flex items-start gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.tax_description_approved} onChange={(e) => setForm((p) => ({ ...p, tax_description_approved: e.target.checked }))} />
                Confirmo que la descripción tributaria es veraz, mínima y no revela notas clínicas
              </label>
              <fieldset className="grid gap-3 rounded-xl border p-3">
                <legend className="px-1 text-sm font-black">Condición para confirmar la reserva</legend>
                <label className="grid gap-1 text-sm font-semibold">
                  Modalidad
                  <select className="rounded-xl border px-3 py-2" value={form.payment_policy} onChange={(e) => setForm((p) => ({ ...p, payment_policy: e.target.value as typeof p.payment_policy, deposit_type: e.target.value === "deposit" ? p.deposit_type ?? "percentage" : null }))}>
                    <option value="no_advance">Reservar sin pago anticipado</option>
                    <option value="deposit">Solicitar un anticipo</option>
                    <option value="full_payment">Solicitar el pago completo</option>
                  </select>
                </label>
                {form.payment_policy === "deposit" ? <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select className="rounded-xl border px-3 py-2" value={form.deposit_type ?? "percentage"} onChange={(e) => setForm((p) => ({ ...p, deposit_type: e.target.value as "fixed_amount" | "percentage" }))}>
                      <option value="percentage">Porcentaje</option>
                      <option value="fixed_amount">Monto fijo CLP</option>
                    </select>
                    <input type="number" min={1} step={form.deposit_type === "percentage" ? 0.01 : 1} className="rounded-xl border px-3 py-2" value={form.deposit_value} onChange={(e) => setForm((p) => ({ ...p, deposit_value: Number(e.target.value) }))} />
                  </div>
                  <p className="text-xs text-amber-800">El saldo queda pendiente. El tratamiento DTE del anticipo permanece en revisión tributaria y no genera folio automáticamente.</p>
                </> : null}
                <label className="grid gap-1 text-sm font-semibold">Expiración provisional (minutos)
                  <input type="number" min={5} max={10080} className="rounded-xl border px-3 py-2" value={form.provisional_expiry_minutes} onChange={(e) => setForm((p) => ({ ...p, provisional_expiry_minutes: Number(e.target.value) }))} />
                </label>
              </fieldset>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                <strong>Documento tributario:</strong> obligatorio para toda venta. Se emitirá boleta o factura según el caso; esta obligación no puede desactivarse.
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1 text-sm font-semibold">
                  Precio
                  <input type="number" min={0} className="min-w-0 rounded-xl border px-3 py-2" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: Number(e.target.value) }))} />
                </label>
                <label className="grid min-w-0 gap-1 text-sm font-semibold">
                  Duración
                  <input type="number" min={5} step={5} className="min-w-0 rounded-xl border px-3 py-2" value={form.duration_min} onChange={(e) => setForm((p) => ({ ...p, duration_min: Number(e.target.value) }))} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
                Servicio activo
              </label>
              {saveError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                  <div>{saveError}</div>
                  <button
                    type="button"
                    onClick={() => void loadServices()}
                    className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-2 font-bold"
                  >
                    Reintentar
                  </button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void saveService()} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                  {saving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear servicio"}
                </button>
                <button type="button" onClick={resetForm} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold text-slate-900">
                  {form.id ? "Cancelar edición" : "Limpiar"}
                </button>
              </div>
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b bg-slate-50 p-3 text-xs font-black text-slate-500">Servicios cargados</div>
            {loading ? (
              <div className="p-4 text-sm text-slate-500">Cargando...</div>
            ) : services.length === 0 ? (
              <div className="p-4">
                <EmptyState title="Aun no hay servicios" description="Crea el primer servicio para que aparezca en la agenda online." />
              </div>
            ) : (
              services.map((service) => (
                <div key={service.id} className="grid min-w-0 gap-3 border-b p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="font-black text-slate-900">{service.name}</div>
                    <div className="mt-1 text-sm text-slate-500">{service.public_description || "Sin descripción pública"}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                      <span className="rounded-full border bg-slate-50 px-2 py-1">{formatDuration(service.duration_min)}</span>
                      <span className="rounded-full border bg-slate-50 px-2 py-1">{formatPrice(service.price, service.currency)}</span>
                      <StatusBadge tone={service.is_active ?? true ? "green" : "slate"}>
                        {service.is_active ?? true ? "Activo" : "Inactivo"}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <button type="button" onClick={() => editService(service)} className="rounded-xl border bg-white px-3 py-2 text-sm font-bold text-slate-900">
                      Editar
                    </button>
                    <button type="button" onClick={() => void toggleServiceActive(service)} disabled={saving} className="rounded-xl border bg-white px-3 py-2 text-sm font-bold text-slate-900 disabled:opacity-60">
                      {service.is_active ?? true ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
    </AdminPageShell>
  );
}
