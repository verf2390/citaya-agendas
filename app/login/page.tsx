"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
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

    // navegación fuerte (evita temas de refresh)
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

        {errorMsg && (
          <p style={{ color: "crimson", margin: 0 }}>❌ {errorMsg}</p>
        )}
      </form>
    </main>
  );
}
