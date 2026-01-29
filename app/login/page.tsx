"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ShimmerButton from "@/components/magicui/ShimmerButton";

/**
 * Página wrapper: en Next (App Router) useSearchParams() debe estar dentro de <Suspense>.
 * Por eso, el componente que usa useSearchParams va adentro.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-6 w-40 rounded bg-slate-100 animate-pulse" />
          <div className="mt-3 h-4 w-64 rounded bg-slate-100 animate-pulse" />
          <div className="mt-6 grid gap-3">
            <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ✅ Solo path (mantiene host/subdominio)
  const redirectTo = useMemo(
    () => searchParams.get("redirectTo") || "/admin/agenda",
    [searchParams],
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ✅ Si ya hay sesión, vuelve directo al redirectTo en el MISMO host
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace(redirectTo);
          return;
        }
      } finally {
        setChecking(false);
      }
    })();
  }, [router, redirectTo]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setErrorMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      // Mensaje más “humano”
      const msg =
        error.message?.toLowerCase().includes("invalid") ||
        error.message?.toLowerCase().includes("credentials")
          ? "Email o contraseña incorrectos."
          : error.message || "No se pudo iniciar sesión.";
      setErrorMsg(msg);
      return;
    }

    // ✅ Mantiene el subdominio actual (fajaspaola.citaya.online)
    router.replace(redirectTo);
  };

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Toque “magic” liviano: fondo suave */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-slate-200/60 via-slate-100/30 to-slate-200/60 blur-3xl" />
        <div className="absolute -bottom-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-100/40 via-slate-100/20 to-emerald-100/30 blur-3xl" />
      </div>

      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur shadow-sm">
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                  🛠️ Panel administrador
                </div>

                <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">
                  Login — Citaya
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Gestiona tu agenda, clientes y reservas en un solo lugar.
                </p>
              </div>

              <span className="hidden sm:inline-flex items-center rounded-full border bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                🔒 Acceso privado
              </span>
            </div>

            {errorMsg ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                ❌ {errorMsg}
              </div>
            ) : null}

            {checking ? (
              <div className="mt-6 grid gap-3">
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
              </div>
            ) : (
              <form onSubmit={onLogin} className="mt-6 grid gap-4">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold text-slate-600">
                    Email
                  </span>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="tu@negocio.cl"
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold text-slate-600">
                    Contraseña
                  </span>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
                  />
                </label>

                <ShimmerButton
                  type="submit"
                  variant="brand"
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Ingresando..." : "Ingresar"}
                </ShimmerButton>

                <div className="text-xs text-slate-500">
                  Tip: si estás en un subdominio (ej.{" "}
                  <span className="font-mono">fajaspaola.citaya.online</span>),
                  el login mantiene ese mismo host.
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Citaya · Agenda simple para negocios pequeños
        </div>
      </div>
    </main>
  );
}
