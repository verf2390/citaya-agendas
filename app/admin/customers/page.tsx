"use client";

import { getTenantSlugFromHostname } from "@/lib/tenant";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { digitsOnly } from "@/app/lib/phone";

import CustomerUpsertModal from "./components/CustomerUpsertModal";

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

  // ✅ Tenant
  const [tenantId, setTenantId] = useState<string>("");
  const [tenantSlug, setTenantSlug] = useState<string>("");
  const [tenantError, setTenantError] = useState<string>("");
  const [loadingTenant, setLoadingTenant] = useState(true);

  // Auth
  const [authChecked, setAuthChecked] = useState(false);

  // Data
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [query, setQuery] = useState("");

  // Modal states
  const [upsertOpen, setUpsertOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  // ✅ Debug opcional: ?debug=1
  const isDebug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";

  /* =====================================================
     1) Resolver tenant por subdominio
  ===================================================== */
  useEffect(() => {
    const run = async () => {
      setLoadingTenant(true);
      setTenantError("");
      setTenantSlug("");
      setTenantId("");

      const hostname = window.location.hostname;
      const slug = getTenantSlugFromHostname(hostname);

      if (!slug) {
        setTenantError(
          "Este panel debe abrirse desde el subdominio del cliente (ej: https://fajaspaola.citaya.online/admin/customers).",
        );
        setLoadingTenant(false);
        return;
      }

      setTenantSlug(slug);

      const { data, error } = await supabase
        .from("tenants")
        .select("id, slug")
        .eq("slug", slug)
        .maybeSingle();

      if (error) {
        setTenantError(`Error buscando cliente (${slug}): ${error.message}`);
        setLoadingTenant(false);
        return;
      }

      if (!data?.id) {
        setTenantError(`No existe un cliente configurado para: ${slug}`);
        setLoadingTenant(false);
        return;
      }

      setTenantId(data.id);
      setLoadingTenant(false);
    };

    void run();
  }, []);

  /* =====================================================
     2) Guard sesión (cuando tenant esté OK)
  ===================================================== */
  useEffect(() => {
    const run = async () => {
      if (loadingTenant) return;
      if (tenantError) return;
      if (!tenantId) return;

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const redirectTo = `${window.location.pathname}${window.location.search || ""}`;
        router.push(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
        return;
      }

      setAuthChecked(true);
    };

    void run();
  }, [router, loadingTenant, tenantError, tenantId]);

  /* =====================================================
     Loaders (API server-side)
  ===================================================== */
  const loadCustomers = async () => {
    if (!tenantId) return;

    setLoading(true);

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!token) {
      setLoading(false);
      setCustomers([]);
      return;
    }

    const res = await fetch(`/api/customers/list?tenantId=${tenantId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    // ✅ Si backend responde Unauthorized, re-login
    if (res.status === 401) {
      const redirectTo = `${window.location.pathname}${window.location.search || ""}`;
      router.push(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
      setLoading(false);
      return;
    }

    if (!res.ok || !json?.ok) {
      console.error("Error loading customers (API):", json);
      setCustomers([]);
      setLoading(false);
      return;
    }

    setCustomers((json.customers ?? []) as CustomerRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecked) return;
    if (!tenantId) return;
    void loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, tenantId]);

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

  /* =====================================================
     UI States
  ===================================================== */
  if (tenantError) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <h2 style={{ marginTop: 0 }}>⚠️ Acceso inválido</h2>
        <p style={{ opacity: 0.8 }}>{tenantError}</p>
        <Link
          href="https://app.citaya.online"
          style={{
            display: "inline-block",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            textDecoration: "none",
            color: "inherit",
            fontSize: 14,
          }}
        >
          Ir al dominio principal
        </Link>
      </main>
    );
  }

  if (loadingTenant || !tenantId) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Cargando cliente…</p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          Subdominio: <b>{tenantSlug || "—"}</b>
        </p>
      </main>
    );
  }

  if (!authChecked) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Validando sesión…</p>
      </main>
    );
  }

  /* =====================================================
     Render
  ===================================================== */
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
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Tenant: <b>{tenantSlug}</b>
            {isDebug ? (
              <span style={{ marginLeft: 8, opacity: 0.8 }}>
                (id: {tenantId})
              </span>
            ) : null}
          </div>
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

      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
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
          onClick={() => void loadCustomers()}
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

      <div
        style={{
          marginTop: 16,
          border: "1px solid #eee",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
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
          <div style={{ padding: 14, fontSize: 13, opacity: 0.7 }}>
            No hay resultados.
          </div>
        )}
      </div>

      {/* ✅ Modal Create/Edit */}
      <CustomerUpsertModal
        open={upsertOpen}
        onClose={() => {
          setUpsertOpen(false);
          setEditing(null);
        }}
        tenantId={tenantId}
        initial={editing}
        onSaved={async () => {
          await loadCustomers();
          setUpsertOpen(false);
          setEditing(null);
        }}
      />
    </main>
  );
}
