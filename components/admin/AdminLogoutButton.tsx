"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { supabase } from "@/lib/supabaseClient";

export default function AdminLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLogout = async () => {
    if (loading) return;

    setError(null);
    setLoading(true);
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      console.error("No se pudo cerrar sesión", signOutError);
      setError("No se pudo cerrar sesión.");
      setLoading(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={onLogout}
        disabled={loading}
        className="admin-secondary-action inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70"
      >
        <LogOut className="h-4 w-4" />
        {loading ? "Cerrando..." : "Cerrar sesión"}
      </button>
      {error ? <p className="px-1 text-xs font-semibold text-red-500">{error}</p> : null}
    </div>
  );
}
