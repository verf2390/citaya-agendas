"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// ⚠️ MVP: tenant hardcodeado. Luego lo sacamos desde profiles/slug.
const TENANT_ID = "04d6c088-338d-44b2-b27b-b4709f48d31b";

type Customer = {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
};

export default function CustomersPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);

  // ✅ Guard de sesión
  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login?redirectTo=/admin/customers");
        return;
      }
      setAuthChecked(true);
    };
    run();
  }, [router]);

  const loadCustomers = async (query?: string) => {
    setLoading(true);

    let req = supabase
      .from("customers")
      .select("id, tenant_id, full_name, phone, email, notes, created_at")
      .eq("tenant_id", TENANT_ID)
      .order("full_name", { ascending: true });

    const term = (query ?? "").trim();
    if (term.length >= 2) {
      req = req.ilike("full_name", `%${term}%`);
    }

    const { data, error } = await req;

    if (error) {
      console.error("Error loading customers:", error);
      setCustomers([]);
      setLoading(false);
      return;
    }

    setCustomers((data as Customer[] | null) ?? []);
    setLoading(false);
  };

  // ✅ Carga inicial
  useEffect(() => {
    if (!authChecked) return;
    loadCustomers("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked]);

  // ✅ Buscador con “debounce” simple
  useEffect(() => {
    if (!authChecked) return;
    const t = setTimeout(() => loadCustomers(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, authChecked]);

  const filteredCountLabel = useMemo(() => {
    const term = q.trim();
    if (term.length < 2) return `${customers.length} clientes`;
    return `${customers.length} resultados`;
  }, [customers.length, q]);

  if (!authChecked) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Validando sesión...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Clientes</h1>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Tenant: {TENANT_ID}</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/admin/agenda" style={{ fontSize: 14, textDecoration: "none" }}>
            ← Volver a Agenda
          </Link>

          <Link
            href="/admin/customers/new"
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            + Nuevo cliente
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre (min 2 letras)…"
          style={{ padding: "10px 12px", minWidth: 320, borderRadius: 10, border: "1px solid #ddd" }}
        />
        <div style={{ fontSize: 13, opacity: 0.75 }}>
          {loading ? "Cargando..." : filteredCountLabel}
        </div>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#fafafa", textAlign: "left" }}>
              <th style={{ padding: 12, fontSize: 12, opacity: 0.7 }}>Nombre</th>
              <th style={{ padding: 12, fontSize: 12, opacity: 0.7 }}>Teléfono</th>
              <th style={{ padding: 12, fontSize: 12, opacity: 0.7 }}>Email</th>
              <th style={{ padding: 12, fontSize: 12, opacity: 0.7, width: 140 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {!loading && customers.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 14, fontSize: 14, opacity: 0.8 }}>
                  No hay clientes (o no hay resultados).
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 12, fontSize: 14 }}>{c.full_name}</td>
                  <td style={{ padding: 12, fontSize: 14, opacity: 0.8 }}>{c.phone ?? "-"}</td>
                  <td style={{ padding: 12, fontSize: 14, opacity: 0.8 }}>{c.email ?? "-"}</td>
                  <td style={{ padding: 12 }}>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid #ddd",
                        background: "white",
                        cursor: "pointer",
                        textDecoration: "none",
                        fontSize: 13,
                      }}
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Tip: el buscador filtra por nombre (MVP). Más adelante agregamos búsqueda por teléfono/email y autocomplete pro.
      </p>
    </main>
  );
}
