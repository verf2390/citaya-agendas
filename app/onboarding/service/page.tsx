"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

export default function OnboardingServicePage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setError("Abre onboarding desde el subdominio del negocio.");
        return;
      }
      const { data, error: tenantError } = await supabase
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (tenantError || !data?.id) {
        setError(tenantError?.message ?? "Tenant no encontrado.");
        return;
      }
      setTenantId(data.id);
    };
    void run();
  }, []);

  const save = async () => {
    if (!tenantId || !name.trim()) return;
    setSaving(true);
    const { data, error: saveError } = await supabase
      .from("services")
      .insert({
        tenant_id: tenantId,
        name: name.trim(),
        price: Number(price) || 0,
        duration_min: duration,
        currency: "CLP",
        is_active: true,
      })
      .select("id")
      .maybeSingle();
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    if (data?.id) window.localStorage.setItem("citaya_onboarding_service_id", data.id);
    router.push("/onboarding/schedule");
  };

  if (error) return <main className="p-6 text-sm text-red-700">{error}</main>;

  return (
    <main className="min-h-screen bg-[#f6f7fb] p-4 sm:p-6">
      <section className="mx-auto max-w-xl rounded-2xl border bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase text-slate-500">Onboarding 1 de 3</div>
        <h1 className="mt-2 text-2xl font-black text-slate-950">Servicio inicial</h1>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1 text-sm font-semibold">
            Nombre servicio
            <input className="rounded-xl border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Precio
            <input type="number" min={0} className="rounded-xl border px-3 py-2" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Duración
            <select className="rounded-xl border px-3 py-2" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
          </label>
          <button type="button" onClick={() => void save()} disabled={saving || !tenantId || !name.trim()} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            {saving ? "Guardando..." : "Continuar"}
          </button>
        </div>
      </section>
    </main>
  );
}
