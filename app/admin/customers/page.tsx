"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { digitsOnly } from "@/app/lib/phone";

import CustomerUpsertModal from "./components/CustomerUpsertModal";

// ⚠️ MVP hardcode
const TENANT_ID = "04d6c088-338d-44b2-b27b-b4709f48d31b";

type CustomerRow = {
  id: string;
  tenant_id?: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  created_at?: string;
};

export default function CustomersPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [query, setQuery] = useState("");

  // ✅ Modal states (IMPORTANTE: van dentro del componente)
  const [upsertOpen, setUpsertOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  // ✅ Guard sesión
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

  const loadCustomers = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customers")
      .select("id, tenant_id, full_name, phone, email, created_at")
      .eq("tenant_id", TENANT_ID)
      .order("full_name", { ascending: true })
      .limit(1000);

    if (error) {
      console.error("Error loading customers:", error);
      setLoading(false);
      return;
    }

    setCustomers(((data as CustomerRow[] | null) ?? []) as CustomerRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecked) return;
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;

    const qDigits = digitsOnly(q);

    return customers.filter((c) => {
      const name = (c.full_name ?? "").toLowerCase();
      const phone = c.phone ?? "";
      return name.includes(q) || (qDigits && phone.includes(qDigits));
    });
  }, [customers, query]);

  if (!authChecked) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Validando sesión...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, fontFamily: "system-ui" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Clientes</h1>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Tenant: {TENANT_ID}</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link
            href="/admin/agenda"
            style={{
              display: "inline-block",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              textDecoration: "none",
              color: "inherit",
              fontSize: 14,
            }}
          >
            ← Volver a Agenda
          </Link>

          <button
            onClick={() => {
              setEditing(null);
              setUpsertOpen(true);
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #111",
              background: "#111",
              color: "white",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            + Nuevo cliente
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o teléfono…"
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            minWidth: 320,
          }}
        />

        <button
          onClick={loadCustomers}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          Recargar
        </button>

        <div style={{ fontSize: 12, opacity: 0.7 }}>
          {loading ? "Cargando..." : `${filtered.length} cliente(s)`}
        </div>
      </div>

      <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 2fr 120px",
            padding: 12,
            fontSize: 12,
            opacity: 0.7,
            background: "#fafafa",
          }}
        >
          <div>Nombre</div>
          <div>Teléfono</div>
          <div>Email</div>
          <div></div>
        </div>

        {filtered.map((c) => (
          <div
            key={c.id}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 2fr 120px",
              padding: 12,
              borderTop: "1px solid #eee",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 700 }}>{c.full_name}</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{c.phone ?? "-"}</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{c.email ?? "-"}</div>

            <button
              onClick={() => {
                setEditing(c);
                setUpsertOpen(true);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Editar
            </button>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 14, fontSize: 13, opacity: 0.7 }}>No hay resultados.</div>
        )}
      </div>

      {/* ✅ Modal Create/Edit */}
      <CustomerUpsertModal
        open={upsertOpen}
        onClose={() => setUpsertOpen(false)}
        tenantId={TENANT_ID}
        initial={editing}
        onSaved={(saved) => {
          setCustomers((prev) => {
            const exists = prev.some((x) => x.id === saved.id);
            if (!exists) return [{ ...saved } as any, ...prev];

            return prev.map((x) => (x.id === saved.id ? ({ ...x, ...saved } as any) : x));
          });
        }}
      />
    </main>
  );
}
