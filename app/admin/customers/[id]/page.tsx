"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type Customer = {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at?: string | null;
};

type HistoryAppointment = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  service_name: string | null;
  service_id: string | null;
  professional_id: string | null;
  professional_name: string | null;
  notes: string | null;
};

type HistorySummary = {
  totalAppointments: number;
  lastVisit: HistoryAppointment | null;
  upcoming: HistoryAppointment | null;
};

function generateCustomerCode(id: string) {
  return `CTY-${id.slice(-6).toUpperCase()}`;
}

function formatDate(value?: string | null) {
  if (!value) return "No disponible";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No disponible";
  return d.toLocaleDateString("es-CL", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EditCustomerPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? "");

  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [loadingTenant, setLoadingTenant] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [appointments, setAppointments] = useState<HistoryAppointment[]>([]);

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
          "Este panel debe abrirse desde el subdominio del cliente.",
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

      if (error || !data?.id) {
        setTenantError(error?.message ?? `No existe tenant para ${slug}`);
        setLoadingTenant(false);
        return;
      }

      setTenantId(data.id);
      setLoadingTenant(false);
    };

    void run();
  }, []);

  // ✅ Guard de sesión
  useEffect(() => {
    const run = async () => {
      if (loadingTenant) return;
      if (tenantError) return;
      if (!tenantId) return;

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?redirectTo=/admin/customers/${id}`);
        return;
      }
      setAuthChecked(true);
    };
    void run();
  }, [router, id, loadingTenant, tenantError, tenantId]);

  const loadCustomer = async () => {
    setLoading(true);

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!token) {
      router.push(`/login?redirectTo=/admin/customers/${id}`);
      return;
    }

    const res = await fetch(
      `/api/customers/${id}/history?tenantId=${encodeURIComponent(tenantId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );

    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      console.error("Error loading customer history:", json);
      alert("No se pudo cargar el cliente");
      router.push("/admin/customers");
      return;
    }

    const c = json.customer as Customer;
    setCustomer(c);
    setFullName(c.full_name ?? "");
    setPhone(c.phone ?? "");
    setEmail(c.email ?? "");
    setNotes(c.notes ?? "");
    setSummary((json.summary ?? null) as HistorySummary | null);
    setAppointments((json.appointments ?? []) as HistoryAppointment[]);

    setLoading(false);
  };

  useEffect(() => {
    if (!authChecked) return;
    if (!id) return;
    if (!tenantId) return;
    void loadCustomer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, id, tenantId]);

  const onSave = async () => {
    const name = fullName.trim();
    if (!name) {
      alert("El nombre es obligatorio");
      return;
    }

    // ✅ Normaliza teléfono: solo números (MVP)
    let phoneDigits = phone.trim().replace(/\D/g, "");
    if (phoneDigits.length === 9 && phoneDigits.startsWith("9")) {
      phoneDigits = "56" + phoneDigits; // 569XXXXXXXX
    }

    setSaving(true);

    const { error } = await supabase
      .from("customers")
      .update({
        full_name: name,
        phone: phoneDigits || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id);

    setSaving(false);

    if (error) {
      console.error("Error updating customer:", error);
      alert("Error guardando cambios");
      return;
    }

    router.push("/admin/customers");
  };

  const onDelete = async () => {
    const ok = confirm("¿Eliminar este cliente? (No se borran citas, solo el cliente)");
    if (!ok) return;

    setDeleting(true);

    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", id);

    setDeleting(false);

    if (error) {
      console.error("Error deleting customer:", error);
      alert("Error eliminando cliente");
      return;
    }

    router.push("/admin/customers");
  };

  if (tenantError) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>{tenantError}</p>
      </main>
    );
  }

  if (loadingTenant || !tenantId) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Cargando cliente...</p>
      </main>
    );
  }

  if (!authChecked) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Validando sesión...</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Cargando cliente...</p>
      </main>
    );
  }

  return (
    <main
      style={{
        padding: 20,
        fontFamily: "system-ui",
        maxWidth: 1120,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>{customer?.full_name ?? "Cliente"}</h1>
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              fontWeight: 800,
              color: "#64748b",
              letterSpacing: "0.05em",
            }}
          >
            {customer ? generateCustomerCode(customer.id) : "—"}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
            {customer?.email || "Sin email"} · {customer?.phone || "Sin teléfono"} · Alta:{" "}
            {formatDate(customer?.created_at)}
          </div>
        </div>
        <Link href="/admin/customers" style={{ textDecoration: "none" }}>
          ← Volver
        </Link>
      </div>

      <div
        style={{
          marginTop: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {[
          {
            label: "Total citas",
            value: String(summary?.totalAppointments ?? 0),
          },
          {
            label: "Última visita",
            value: summary?.lastVisit
              ? `${formatDate(summary.lastVisit.start_at)} ${formatTime(summary.lastVisit.start_at)}`
              : "No disponible",
          },
          {
            label: "Próxima cita",
            value: summary?.upcoming
              ? `${formatDate(summary.upcoming.start_at)} ${formatTime(summary.upcoming.start_at)}`
              : "No disponible",
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: 16,
              background: "#f8fafc",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
              {item.label}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 18,
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 18,
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          overflow: "hidden",
          background: "white",
        }}
      >
        <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", fontWeight: 800 }}>
          Historial de servicios
        </div>

        {appointments.length === 0 ? (
          <div style={{ padding: 18, color: "#64748b" }}>
            Este cliente aún no tiene historial de servicios.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 860 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr 0.8fr 1.4fr 1.2fr 0.8fr 1.4fr",
                  gap: 12,
                  padding: 14,
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#64748b",
                  background: "#f8fafc",
                }}
              >
                <div>Fecha</div>
                <div>Hora</div>
                <div>Servicio</div>
                <div>Profesional</div>
                <div>Estado</div>
                <div>Notas</div>
              </div>

              {appointments.map((appt) => (
                <div
                  key={appt.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.1fr 0.8fr 1.4fr 1.2fr 0.8fr 1.4fr",
                    gap: 12,
                    padding: 14,
                    borderTop: "1px solid #e2e8f0",
                    alignItems: "center",
                    fontSize: 13,
                  }}
                >
                  <div>{formatDate(appt.start_at)}</div>
                  <div>
                    {formatTime(appt.start_at)} - {formatTime(appt.end_at)}
                  </div>
                  <div>{appt.service_name || "Servicio"}</div>
                  <div>{appt.professional_name || "—"}</div>
                  <div>{appt.status}</div>
                  <div>{appt.notes?.trim() || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {/* TODO: mostrar historial de citas/servicios aquí con más detalle si se amplía la ficha */}
        <div style={{ fontWeight: 800 }}>Editar ficha</div>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Nombre *</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Teléfono (opcional)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ej: 956655664 (o +56 9 5665 5664)"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Correo (opcional)</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Notas (opcional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", minHeight: 90 }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: saving ? "#f5f5f5" : "white",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>

          <button
            onClick={onDelete}
            disabled={deleting}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #f2c2c2",
              background: deleting ? "#fdf2f2" : "white",
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            {deleting ? "Eliminando..." : "Eliminar"}
          </button>
        </div>

        <p style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Nota: si el cliente tiene citas relacionadas, como tu FK es <code>ON DELETE SET NULL</code>, las citas quedan pero el <code>customer_id</code> se limpia.
        </p>
      </div>
    </main>
  );
}
