"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import ShimmerButton from "@/components/magicui/ShimmerButton";

type LoginTenant = {
  slug: string;
  name: string;
  logo_url: string | null;
  description: string | null;
};

function isLoginTenant(value: unknown): value is LoginTenant {
  if (typeof value !== "object" || value === null) return false;
  const tenant = value as Record<string, unknown>;

  return (
    typeof tenant.slug === "string" &&
    typeof tenant.name === "string" &&
    (tenant.logo_url === null || typeof tenant.logo_url === "string") &&
    (tenant.description === null || typeof tenant.description === "string")
  );
}

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
  const [showPassword, setShowPassword] = useState(false);
  const [tenant, setTenant] = useState<LoginTenant | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const businessName = tenant?.name ?? "Citaya";
  const title = `Login — ${businessName}`;
  const subtitle = tenant
    ? `Panel privado para gestionar agenda, clientes y reservas de ${tenant.name}.`
    : "Gestiona tu agenda, clientes y reservas en un solo lugar.";

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

  useEffect(() => {
    const slug = getTenantSlugFromHostname(window.location.hostname);
    if (!slug) return;

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(
          `/api/tenants/by-slug?slug=${encodeURIComponent(slug)}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;

        const json: unknown = await res.json();
        const maybeTenant =
          typeof json === "object" && json !== null
            ? (json as Record<string, unknown>).tenant
            : null;

        if (isLoginTenant(maybeTenant)) {
          setTenant({
            slug: maybeTenant.slug,
            name: maybeTenant.name,
            logo_url: maybeTenant.logo_url,
            description: maybeTenant.description,
          });
        }
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          console.error("[login] tenant lookup error:", error);
        }
      }
    })();

    return () => controller.abort();
  }, []);

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
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                  Panel administrador
                </div>

                <div className="mt-4 flex items-center gap-3">
                  {tenant?.logo_url ? (
                    <Image
                      src={tenant.logo_url}
                      alt={tenant.name}
                      width={48}
                      height={48}
                      unoptimized
                      className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-white object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-900 text-sm font-bold text-white">
                      {businessName.slice(0, 1).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                      {title}
                    </h1>
                    {tenant?.description ? (
                      <p className="mt-1 truncate text-xs font-medium text-slate-500">
                        {tenant.description}
                      </p>
                    ) : null}
                  </div>
                </div>

                <p className="mt-1 text-sm text-slate-600">
                  {subtitle}
                </p>
              </div>

              <span className="hidden sm:inline-flex items-center rounded-full border bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Acceso privado
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
                  <div className="relative">
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 pr-12 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
                    />
                    <button
                      type="button"
                      aria-label={
                        showPassword
                          ? "Ocultar contraseña"
                          : "Mostrar contraseña"
                      }
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-500 transition hover:text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-200/60"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
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
                  Estás entrando al panel privado de este negocio. Usa el correo
                  autorizado para este tenant.
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
