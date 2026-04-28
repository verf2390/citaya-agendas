"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

const DAYS = [
  { id: 1, label: "L" },
  { id: 2, label: "M" },
  { id: 3, label: "M" },
  { id: 4, label: "J" },
  { id: 5, label: "V" },
];

export default function OnboardingSchedulePage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setError("Abre onboarding desde el subdominio del negocio.");
        return;
      }
      const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (tenantError || !tenant?.id) {
        setError(tenantError?.message ?? "Tenant no encontrado.");
        return;
      }
      setTenantId(tenant.id);

      const res = await fetch(`/api/admin/professionals/list?tenantId=${encodeURIComponent(tenant.id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      const firstProfessional = json?.professionals?.[0]?.id ?? "";
      if (!firstProfessional) {
        setError("No hay profesionales configurados para este tenant.");
        return;
      }
      setProfessionalId(firstProfessional);
    };
    void run();
  }, []);

  const toggleDay = (day: number) => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  };

  const save = async () => {
    if (!tenantId || !professionalId || days.length === 0) return;
    setSaving(true);
    const res = await fetch("/api/admin/availability/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        professionalId,
        items: days.map((day) => ({
          day_of_week: day,
          start_time: startTime,
          end_time: endTime,
          is_active: true,
        })),
      }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "No se pudo guardar disponibilidad.");
      return;
    }
    router.push("/onboarding/confirm");
  };

  if (error) return <main className="p-6 text-sm text-red-700">{error}</main>;

  return (
    <main className="min-h-screen bg-[#f6f7fb] p-4 sm:p-6">
      <section className="mx-auto max-w-xl rounded-2xl border bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase text-slate-500">Onboarding 2 de 3</div>
        <h1 className="mt-2 text-2xl font-black text-slate-950">Horario base</h1>
        <div className="mt-5 grid gap-4">
          <div className="flex gap-2">
            {DAYS.map((day) => (
              <button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`h-11 w-11 rounded-xl border text-sm font-black ${days.includes(day.id) ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>
                {day.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              Hora inicio
              <input type="time" className="rounded-xl border px-3 py-2" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Hora fin
              <input type="time" className="rounded-xl border px-3 py-2" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </div>
          <button type="button" onClick={() => void save()} disabled={saving || !professionalId} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            {saving ? "Guardando..." : "Continuar"}
          </button>
        </div>
      </section>
    </main>
  );
}
