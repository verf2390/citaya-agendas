"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

/** Fallback simple mientras Next resuelve los search params */
function LoginFallback() {
  return (
    <main style={{ padding: 30, fontFamily: "system-ui", maxWidth: 420 }}>
      <h1>Login — Citaya</h1>
      <p>Cargando…</p>
    </main>
  );
}

function LoginInner() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/admin/agenda";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    // Navegación fuerte (evita temas de refresh)
    window.location.href = redirectTo;
  };

  return (
    <main style={{ padding: 30, fontFamily: "system-ui", maxWidth: 420 }}>
      <h1>Login — Citaya</h1>

      <form onSubmit={onLogin} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            style={{ padding: 10 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            style={{ padding: 10 }}
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 10,
            cursor: "pointer",
            background: "#2563eb",
            color: "white",
            borderRadius: 8,
            border: "none",
          }}
        >
          {loading ? "Ingresando..." : "Ingresar"}
        </button>

        {errorMsg && <p style={{ color: "crimson", margin: 0 }}>❌ {errorMsg}</p>}
      </form>
    </main>
  );
}

