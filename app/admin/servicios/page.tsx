"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/admin/AdminNav";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type ServiceRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
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
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setTenantError("Este panel debe abrirse desde el subdominio del cliente.");
        setLoading(false);
        return;
      }
      setTenantSlug(slug);

      const { data, error } = await supabase
        .from("tenants")
        .select("id, slug")
        .eq("slug", slug)
        .maybeSingle();

      if (error || !data?.id) {
        setTenantError(error?.message ?? `No existe tenant para ${slug}`);
        setLoading(false);
        return;
      }

      setTenantId(data.id);
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

    const token = await getAuthToken();
    if (!token) {
      setSaveError("Sesión expirada. Vuelve a iniciar sesión.");
      setServices([]);
      setLoading(false);
      return;
    }

    const res = await fetch(`/api/admin/services?tenantId=${encodeURIComponent(tenantId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !Array.isArray(json?.services)) {
      console.error("[admin/servicios] load error:", json);
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
      duration_min: service.duration_min ?? 60,
      price: service.price ?? 0,
      currency: service.currency ?? "CLP",
      is_active: service.is_active ?? true,
    });
  };

  const saveService = async () => {
    const name = form.name.trim();
    if (!name) {
      alert("El nombre del servicio es obligatorio.");
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

    const res = await fetch("/api/admin/services", {
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
      alert(message);
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

    const res = await fetch("/api/admin/services", {
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
      alert(message);
      return;
    }

    if (form.id === service.id) {
      setForm((prev) => ({ ...prev, is_active: nextActive }));
    }
    await loadServices();
  };

  if (tenantError) {
    return <main className="p-6 text-sm text-red-700">{tenantError}</main>;
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f6f7fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl min-w-0">
        <AdminNav />
        <div>
          <h1 className="text-2xl font-black text-slate-950">Servicios</h1>
          <p className="mt-1 text-sm text-slate-500">Precios y duración para {tenantSlug || "..."}.</p>
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
                Descripción
                <textarea className="min-h-24 min-w-0 rounded-xl border px-3 py-2" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </label>
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
                  {saveError}
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
              <div className="p-4 text-sm text-slate-500">Aún no hay servicios.</div>
            ) : (
              services.map((service) => (
                <div key={service.id} className="grid min-w-0 gap-3 border-b p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="font-black text-slate-900">{service.name}</div>
                    <div className="mt-1 text-sm text-slate-500">{service.description || "Sin descripción"}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                      <span className="rounded-full border bg-slate-50 px-2 py-1">{formatDuration(service.duration_min)}</span>
                      <span className="rounded-full border bg-slate-50 px-2 py-1">{formatPrice(service.price, service.currency)}</span>
                      <span className={`rounded-full border px-2 py-1 ${service.is_active ?? true ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500"}`}>
                        {service.is_active ?? true ? "Activo" : "Inactivo"}
                      </span>
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
      </div>
    </main>
  );
}
