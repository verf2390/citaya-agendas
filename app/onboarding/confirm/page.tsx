"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getTenantSlugFromHostname } from "@/lib/tenant";

export default function OnboardingConfirmPage() {
  const [slug, setSlug] = useState("");
  const publicLink = useMemo(
    () => (slug ? `https://${slug}.citaya.online` : ""),
    [slug],
  );

  useEffect(() => {
    setSlug(getTenantSlugFromHostname(window.location.hostname) ?? "");
  }, []);

  return (
    <main className="min-h-screen bg-[#f6f7fb] p-4 sm:p-6">
      <section className="mx-auto max-w-xl rounded-2xl border bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase text-slate-500">Onboarding 3 de 3</div>
        <h1 className="mt-2 text-2xl font-black text-slate-950">Listo para recibir reservas</h1>
        <div className="mt-5 rounded-xl border bg-slate-50 p-3 text-sm font-bold text-slate-700">
          {publicLink || "Link público no disponible en este host"}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => publicLink && navigator.clipboard.writeText(publicLink)} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold">
            Copiar link
          </button>
          <Link href="/admin/agenda" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
            Ir a admin
          </Link>
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          TODO seguro: activar redirección automática solo cuando el flujo de tenants existentes esté validado.
        </div>
      </section>
    </main>
  );
}
