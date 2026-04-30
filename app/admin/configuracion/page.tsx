"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
} from "@/components/admin/admin-ui";
import { toast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type TenantForm = {
  name: string;
  phone_display: string;
  admin_email: string;
  address: string;
  city: string;
  description: string;
  logo_url: string;
};

export default function ConfiguracionPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TenantForm>({
    name: "",
    phone_display: "",
    admin_email: "",
    address: "",
    city: "",
    description: "",
    logo_url: "",
  });

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
        .select("id, slug, name, phone_display, admin_email, address, city, description, logo_url")
        .eq("slug", slug)
        .maybeSingle();

      if (error || !data?.id) {
        setTenantError(error?.message ?? `No existe tenant para ${slug}`);
        setLoading(false);
        return;
      }

      setTenantId(data.id);
      setForm({
        name: data.name ?? "",
        phone_display: data.phone_display ?? "",
        admin_email: data.admin_email ?? "",
        address: data.address ?? "",
        city: data.city ?? "",
        description: data.description ?? "",
        logo_url: data.logo_url ?? "",
      });
      setLoading(false);
    };

    void run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!tenantId || tenantError) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?redirectTo=${encodeURIComponent("/admin/configuracion")}`);
        return;
      }
      setAuthChecked(true);
    };
    void run();
  }, [router, tenantId, tenantError]);

  const save = async () => {
    if (!tenantId) return;
    if (!form.name.trim()) {
      toast({ title: "El nombre del negocio es obligatorio", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        name: form.name.trim(),
        phone_display: form.phone_display.trim() || null,
        admin_email: form.admin_email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        description: form.description.trim() || null,
        logo_url: form.logo_url.trim() || null,
      })
      .eq("id", tenantId);

    setSaving(false);

    if (error) {
      console.error("[admin/configuracion] save error:", error);
      toast({ title: "No se pudo guardar la configuracion", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Configuracion guardada" });
  };

  if (tenantError) {
    return <main className="p-6 text-sm text-red-700">{tenantError}</main>;
  }

  return (
    <AdminPageShell width="narrow">
        <AdminNav />
        <AdminPageHeader
          eyebrow="Negocio"
          title="Configuración"
          description={`Datos publicos basicos para ${tenantSlug || "..."}.`}
        />

        <AdminSectionCard className="mt-5" title="Perfil publico" description="Cambios seguros sobre datos del tenant actual.">
          {loading || !authChecked ? (
            <div className="text-sm text-slate-500">Cargando configuración...</div>
          ) : (
            <div className="grid gap-4">
              <label className="grid gap-1 text-sm font-semibold">
                Nombre negocio
                <input className="rounded-xl border px-3 py-2" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold">
                  Teléfono visible
                  <input className="rounded-xl border px-3 py-2" value={form.phone_display} onChange={(e) => setForm((p) => ({ ...p, phone_display: e.target.value }))} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Email visible/admin
                  <input className="rounded-xl border px-3 py-2" value={form.admin_email} onChange={(e) => setForm((p) => ({ ...p, admin_email: e.target.value }))} />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold">
                  Dirección
                  <input className="rounded-xl border px-3 py-2" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Ciudad
                  <input className="rounded-xl border px-3 py-2" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
                </label>
              </div>
              <label className="grid gap-1 text-sm font-semibold">
                Descripción
                <textarea className="min-h-28 rounded-xl border px-3 py-2" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Logo URL
                <input className="rounded-xl border px-3 py-2" value={form.logo_url} onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))} />
              </label>
              <button type="button" onClick={() => void save()} disabled={saving} className="w-fit rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                {saving ? "Guardando..." : "Guardar configuración"}
              </button>
            </div>
          )}
        </AdminSectionCard>
    </AdminPageShell>
  );
}
