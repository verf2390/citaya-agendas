"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  whatsapp: string;
  contact_email: string;
  address: string;
  city: string;
  description: string;
  logo_url: string;
};

function countPhoneDigits(value: string) {
  return value.replace(/\D/g, "").length;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

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
    whatsapp: "",
    contact_email: "",
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
        .select("id, slug, name, phone_display, whatsapp, contact_email, address, city, description, logo_url")
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
        whatsapp: data.whatsapp ?? "",
        contact_email: data.contact_email ?? "",
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
    if (form.whatsapp.trim() && countPhoneDigits(form.whatsapp) < 8) {
      toast({
        title: "WhatsApp inválido",
        description: "Ingresa un WhatsApp con al menos 8 dígitos.",
        variant: "destructive",
      });
      return;
    }
    if (form.contact_email.trim() && !isValidEmail(form.contact_email.trim())) {
      toast({
        title: "Ingresa un email válido para el contacto del negocio.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      setSaving(false);
      router.push(`/login?redirectTo=${encodeURIComponent("/admin/configuracion")}`);
      return;
    }

    const res = await fetch("/api/admin/tenant", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenantSlug,
        name: form.name.trim(),
        phone_display: form.phone_display.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        contact_email: form.contact_email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        description: form.description.trim() || null,
        logo_url: form.logo_url.trim() || null,
      }),
    });
    const json = await res.json().catch(() => null);

    setSaving(false);

    if (!res.ok || !json?.ok) {
      const message = json?.error ?? "No se pudo guardar la configuración.";
      console.error("[admin/configuracion] save error:", message);
      toast({ title: "No se pudo guardar la configuración", description: message, variant: "destructive" });
      return;
    }

    toast({ title: "Configuración guardada" });
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

        <AdminSectionCard
          className="mt-5"
          title="Configuración general"
          description="Administra la información base del negocio, identidad visual, datos de contacto y preferencias generales."
          actions={
            <Link
              href="/admin/pagos"
              className="rounded-xl border bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Ir a Pagos
            </Link>
          }
        >
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm font-bold text-sky-800">
            Los métodos de cobro ahora se administran desde la pestaña Pagos.
          </div>
        </AdminSectionCard>

        <AdminSectionCard className="mt-5" title="Perfil público" description="Datos visibles para clientes en reservas, mensajes y campañas.">
          {loading || !authChecked ? (
            <div className="text-sm text-slate-500">Cargando configuración...</div>
          ) : (
            <div className="grid gap-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4">
                  <div className="text-sm font-black text-slate-900">Identidad del negocio</div>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Información principal que verán tus clientes.
                  </p>
                </div>
                <div className="grid gap-4">
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Nombre negocio
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                      value={form.name}
                      onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Descripción
                    <textarea
                      className="min-h-28 rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Logo URL
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                      value={form.logo_url}
                      onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))}
                      placeholder="https://..."
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4">
                  <div className="text-sm font-black text-slate-900">Canales de contacto</div>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Se usarán para botones de contacto, campañas y recordatorios.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Teléfono visible
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                      value={form.phone_display}
                      onChange={(e) => setForm((p) => ({ ...p, phone_display: e.target.value }))}
                      placeholder="+56 2 2345 6789"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    WhatsApp del negocio
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                      value={form.whatsapp}
                      onChange={(e) => setForm((p) => ({ ...p, whatsapp: e.target.value }))}
                      placeholder="+56 9 1234 5678"
                    />
                    <span className="text-xs font-semibold text-slate-500">
                      Se usará para botones de contacto, campañas y recordatorios.
                    </span>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                    Email visible/contacto
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                      value={form.contact_email}
                      onChange={(e) => setForm((p) => ({ ...p, contact_email: e.target.value }))}
                      placeholder="contacto@negocio.cl"
                    />
                    <span className="text-xs font-semibold text-slate-500">
                      Se mostrará como canal de contacto para clientes. El envío técnico puede seguir saliendo desde Citaya.
                    </span>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4">
                  <div className="text-sm font-black text-slate-900">Ubicación</div>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Datos generales de referencia para tus clientes.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Dirección
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                      value={form.address}
                      onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Ciudad
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                      value={form.city}
                      onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                    />
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void save()} disabled={saving} className="w-fit rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                  {saving ? "Guardando..." : "Guardar configuración"}
                </button>
                <span className="text-xs font-semibold text-slate-500">
                  Estos datos se usan en comunicaciones públicas del negocio.
                </span>
              </div>
            </div>
          )}
        </AdminSectionCard>
    </AdminPageShell>
  );
}
