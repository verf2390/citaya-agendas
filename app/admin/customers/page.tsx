"use client";

import { getTenantSlugFromHostname } from "@/lib/tenant";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { digitsOnly } from "@/app/lib/phone";

import CustomerUpsertModal from "./components/CustomerUpsertModal";
import AdminNav from "@/components/admin/AdminNav";
import {
  CustomerStatusBadge,
  EmptyState,
  StatusBadge,
  getCustomerVisualStatus,
} from "@/components/admin/admin-ui";

type CustomerRow = {
  id: string;
  tenant_id?: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes?: string | null;
  created_at?: string;
  stats?: {
    appointment_count: number;
    last_appointment_at: string | null;
    total_paid: number;
    pending_payments: number;
  };
};

type BulkChannel = "email" | "whatsapp" | "both";
type BulkAudience = "all" | "email" | "phone";
type QuickFilter =
  | "all"
  | "with_email"
  | "with_phone"
  | "without_email"
  | "recent"
  | "recurring"
  | "inactive"
  | "pending_payment";
type ExportMenu = null | "open";

function generateCustomerCode(id: string) {
  return `CTY-${id.slice(-6).toUpperCase()}`;
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  return amount.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
}

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
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);

  // Modal states
  const [upsertOpen, setUpsertOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkChannel, setBulkChannel] = useState<BulkChannel>("email");
  const [bulkAudience, setBulkAudience] = useState<BulkAudience>("all");
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [campaignImageUrl, setCampaignImageUrl] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [bulkSuccess, setBulkSuccess] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [exportMenu, setExportMenu] = useState<ExportMenu>(null);

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

  const recentWindowMs = 1000 * 60 * 60 * 24 * 30;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digitsOnly(q);
    const now = Date.now();

    return customers.filter((c) => {
      if (quickFilter === "with_email" && !c.email?.trim()) return false;
      if (quickFilter === "with_phone" && !c.phone?.trim()) return false;
      if (quickFilter === "without_email" && c.email?.trim()) return false;
      if (quickFilter === "recent") {
        if (!c.created_at) return false;
        const ts = new Date(c.created_at).getTime();
        if (!Number.isFinite(ts) || now - ts > recentWindowMs) return false;
      }
      if (quickFilter === "recurring" && getCustomerVisualStatus(c) !== "recurring") return false;
      if (quickFilter === "inactive" && getCustomerVisualStatus(c) !== "inactive") return false;
      if (quickFilter === "pending_payment" && Number(c.stats?.pending_payments ?? 0) <= 0) return false;

      if (!q) return true;

      const name = (c.full_name ?? "").toLowerCase();
      const phone = c.phone ?? "";
      const email = (c.email ?? "").toLowerCase();
      return (
        name.includes(q) ||
        email.includes(q) ||
        (qDigits && phone.includes(qDigits))
      );
    });
  }, [customers, query, quickFilter, recentWindowMs]);

  const metrics = useMemo(() => {
    const now = Date.now();

    return {
      total: customers.length,
      withEmail: customers.filter((c) => !!c.email?.trim()).length,
      withPhone: customers.filter((c) => !!c.phone?.trim()).length,
      recent: customers.filter((c) => {
        if (!c.created_at) return false;
        const ts = new Date(c.created_at).getTime();
        return Number.isFinite(ts) && now - ts <= recentWindowMs;
      }).length,
      totalPaid: customers.reduce(
        (sum, c) => sum + Number(c.stats?.total_paid ?? 0),
        0,
      ),
      pendingPayments: customers.reduce(
        (sum, c) => sum + Number(c.stats?.pending_payments ?? 0),
        0,
      ),
    };
  }, [customers]);

  useEffect(() => {
    setSelectedCustomerIds((prev) => {
      const availableIds = new Set(customers.map((c) => c.id));
      return prev.filter((id) => availableIds.has(id));
    });
  }, [customers]);

  const selectedCustomers = useMemo(() => {
    if (selectedCustomerIds.length === 0) return [];

    const selectedIds = new Set(selectedCustomerIds);
    return customers.filter((c) => selectedIds.has(c.id));
  }, [customers, selectedCustomerIds]);

  const bulkRecipients = useMemo(() => {
    const source =
      selectedCustomers.length > 0 ? selectedCustomers : customers;

    return source
      .filter((c) => {
        if (selectedCustomers.length > 0) return true;
        if (bulkAudience === "email") return !!c.email?.trim();
        if (bulkAudience === "phone") return !!c.phone?.trim();
        return true;
      })
      .map((c) => ({
        customer_id: c.id,
        name: c.full_name || "Cita",
        email: c.email ?? null,
        phone: c.phone ?? null,
      }));
  }, [customers, selectedCustomers, bulkAudience]);

  const selectedVisibleCount = useMemo(() => {
    const selectedIds = new Set(selectedCustomerIds);
    return filtered.filter((c) => selectedIds.has(c.id)).length;
  }, [filtered, selectedCustomerIds]);

  const allVisibleSelected =
    filtered.length > 0 && selectedVisibleCount === filtered.length;

  const toggleCustomerSelection = (customerId: string) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(customerId)
        ? prev.filter((id) => id !== customerId)
        : [...prev, customerId],
    );
    setBulkSuccess("");
  };

  const handleSelectVisible = () => {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((c) => next.add(c.id));
      return Array.from(next);
    });
    setBulkSuccess("");
  };

  const handleClearSelection = () => {
    setSelectedCustomerIds([]);
    setBulkSuccess("");
  };

  const bulkPayload = useMemo(
    () => ({
      tenant_id: tenantId,
      tenant_slug: tenantSlug,
      channel: bulkChannel,
      subject: bulkSubject.trim(),
      message: bulkMessage.trim(),
      campaign_image_url: campaignImageUrl.trim(),
      recipients: bulkRecipients,
    }),
    [
      tenantId,
      tenantSlug,
      bulkChannel,
      bulkSubject,
      bulkMessage,
      campaignImageUrl,
      bulkRecipients,
    ],
  );

  const formatCreatedAt = (value?: string) => {
    if (!value) return "No disponible";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "No disponible";
    return d.toLocaleDateString("es-CL", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  };

  const escapeCSV = (value: string | null | undefined) => {
    const safe = value ?? "";
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const handleExportCSV = () => {
    const rows = filtered.map((c) => [
      c.full_name ?? "",
      c.phone ?? "",
      c.email ?? "",
      c.notes ?? "",
      formatCreatedAt(c.created_at),
    ]);

    const csv = [
      ["Nombre", "Teléfono", "Email", "Notas", "Fecha de creación"]
        .map(escapeCSV)
        .join(";"),
      ...rows.map((row) => row.map((cell) => escapeCSV(cell)).join(";")),
    ].join("\n");

    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clientes-${tenantSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportMenu(null);
  };

  const truncateText = (value: string | null | undefined, max = 48) => {
    const safe = (value ?? "").trim();
    if (!safe) return "";
    return safe.length > max ? `${safe.slice(0, max - 1)}…` : safe;
  };

  const handleExportPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 14;
    let y = 18;

    const addPageIfNeeded = (nextY: number) => {
      if (nextY <= pageHeight - 12) return nextY;
      doc.addPage();
      return 18;
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Clientes", marginX, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Tenant: ${tenantSlug}`, marginX, y);
    y += 5;
    doc.text(
      `Fecha: ${new Date().toLocaleDateString("es-CL")} ${new Date().toLocaleTimeString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      marginX,
      y,
    );
    y += 8;

    filtered.forEach((c, index) => {
      y = addPageIfNeeded(y + 20);

      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, y - 3, pageWidth - marginX, y - 3);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`${index + 1}. ${c.full_name || "Cliente"}`, marginX, y + 2);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const phone = c.phone?.trim() || "Sin teléfono";
      const email = c.email?.trim() || "Sin email";
      const notes = truncateText(c.notes, 70) || "Sin notas";
      const createdAt = formatCreatedAt(c.created_at);

      doc.text(`Tel: ${phone}`, marginX, y + 8);
      doc.text(`Email: ${email}`, marginX, y + 13);
      doc.text(`Notas: ${notes}`, marginX, y + 18);
      doc.text(`Alta: ${createdAt}`, pageWidth - marginX, y + 18, {
        align: "right",
      });

      y += 24;
    });

    doc.save(`clientes-${tenantSlug}.pdf`);
    setExportMenu(null);
  };

  const handleSendBulkMessage = async () => {
    if (bulkSending) return;

    const subjectRequired = bulkChannel === "email";

    setBulkSuccess("");

    if (subjectRequired && !bulkSubject.trim()) {
      setBulkError("El asunto es obligatorio para mensajes por email.");
      return;
    }

    if (!bulkMessage.trim()) {
      setBulkError("El mensaje no puede estar vacío.");
      return;
    }

    if (bulkRecipients.length === 0) {
      setBulkError("No hay destinatarios disponibles para esta selección.");
      return;
    }

    setBulkError("");

    try {
      setBulkSending(true);

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      const res = await fetch("/api/admin/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(bulkPayload),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setBulkError(
          json?.error || "No se pudo enviar la campaña a automatización.",
        );
        return;
      }

      setBulkSuccess(
        json.message ||
          `Campaña enviada a automatización (${bulkRecipients.length} destinatarios).`,
      );
    } catch (e: any) {
      setBulkError(
        e?.message || "No se pudo enviar la campaña a automatización.",
      );
    } finally {
      setBulkSending(false);
    }
  };

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
    <main
      style={{
        minHeight: "100vh",
        padding: 20,
        fontFamily: "system-ui",
        background:
          "radial-gradient(circle at top, rgba(15,23,42,0.06), transparent 22%), linear-gradient(180deg, #eef3f8 0%, #f8fafc 24%, #eef3f8 100%)",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <AdminNav />
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
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(15,23,42,0.08)",
              background: "rgba(255,255,255,0.75)",
              fontSize: 12,
              fontWeight: 700,
              color: "#334155",
              marginBottom: 10,
            }}
          >
            CRM Citaya
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 32,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            Clientes
          </h1>

          <div style={{ fontSize: 14, opacity: 0.72, marginTop: 8 }}>
            Base de clientes del negocio
          </div>

          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
            Tenant: <b>{tenantSlug}</b>
            {isDebug ? (
              <span style={{ marginLeft: 8, opacity: 0.8 }}>
                (id: {tenantId})
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => {
              setBulkError("");
              setBulkSuccess("");
              setBulkOpen(true);
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #111827",
              background: "#111827",
              color: "white",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              boxShadow: "0 10px 24px rgba(15,23,42,0.16)",
            }}
          >
            Nuevo mensaje
          </button>

          <Link
            href="/admin/campanas"
            style={{
              display: "inline-block",
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #cbd5e1",
              background: "rgba(255,255,255,0.82)",
              textDecoration: "none",
              color: "#0f172a",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Campañas
          </Link>

          <div style={{ position: "relative" }}>
            <button
              onClick={() =>
                setExportMenu((prev) => (prev === "open" ? null : "open"))
              }
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                background: "rgba(255,255,255,0.82)",
                color: "#0f172a",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Exportar
            </button>

            {exportMenu === "open" ? (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  minWidth: 180,
                  borderRadius: 14,
                  border: "1px solid #cbd5e1",
                  background: "white",
                  boxShadow: "0 16px 32px rgba(15,23,42,0.12)",
                  overflow: "hidden",
                  zIndex: 20,
                }}
              >
                <button
                  onClick={handleExportCSV}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    background: "white",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  Exportar CSV
                </button>
                <button
                  onClick={() => void handleExportPDF()}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    borderTop: "1px solid #e2e8f0",
                    background: "white",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  Exportar PDF
                </button>
              </div>
            ) : null}
          </div>

          <Link
            href="/admin/agenda"
            style={{
              display: "inline-block",
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #cbd5e1",
              background: "rgba(255,255,255,0.82)",
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
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "white",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            + Nuevo cliente
          </button>
        </div>
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
            label: "Total de clientes",
            value: metrics.total,
            tone: "linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)",
          },
          {
            label: "Con email",
            value: metrics.withEmail,
            tone: "linear-gradient(180deg,#eff6ff 0%,#dbeafe 100%)",
          },
          {
            label: "Con teléfono",
            value: metrics.withPhone,
            tone: "linear-gradient(180deg,#f0fdf4 0%,#dcfce7 100%)",
          },
          {
            label: "Total pagado",
            value: formatMoney(metrics.totalPaid),
            tone: "linear-gradient(180deg,#f0fdf4 0%,#dcfce7 100%)",
          },
          {
            label: "Pagos pendientes",
            value: metrics.pendingPayments,
            tone: "linear-gradient(180deg,#fff7ed 0%,#ffedd5 100%)",
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              borderRadius: 18,
              border: "1px solid rgba(148,163,184,0.18)",
              background: item.tone,
              padding: 18,
              boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
              {item.label}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 28,
                fontWeight: 800,
                lineHeight: 1,
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
            flex: "1 1 320px",
            padding: "12px 14px",
            borderRadius: 14,
            border: "1px solid #cbd5e1",
            minWidth: 320,
            background: "rgba(255,255,255,0.9)",
          }}
        />

        <button
          onClick={() => void loadCustomers()}
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            border: "1px solid #cbd5e1",
            background: "rgba(255,255,255,0.9)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Recargar
        </button>

        <div style={{ fontSize: 12, opacity: 0.7 }}>
          {loading
            ? "Cargando..."
            : `${filtered.length} clientes · ${selectedCustomerIds.length} seleccionados`}
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {[
          { id: "all", label: "Todos" },
          { id: "with_email", label: "Con email" },
          { id: "with_phone", label: "Con teléfono" },
          { id: "without_email", label: "Sin email" },
          { id: "recent", label: "Recientes" },
          { id: "recurring", label: "Recurrentes" },
          { id: "inactive", label: "Inactivos" },
          { id: "pending_payment", label: "Pago pendiente" },
        ].map((item) => {
          const active = quickFilter === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setQuickFilter(item.id as QuickFilter)}
              style={{
                padding: "9px 12px",
                borderRadius: 999,
                border: active
                  ? "1px solid #0f172a"
                  : "1px solid rgba(148,163,184,0.28)",
                background: active ? "#0f172a" : "rgba(255,255,255,0.82)",
                color: active ? "white" : "#334155",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {item.label}
            </button>
          );
        })}

        <button
          onClick={handleSelectVisible}
          disabled={filtered.length === 0 || allVisibleSelected}
          style={{
            padding: "9px 12px",
            borderRadius: 999,
            border: "1px solid rgba(148,163,184,0.34)",
            background: allVisibleSelected ? "#e2e8f0" : "rgba(255,255,255,0.82)",
            color: "#334155",
            cursor:
              filtered.length === 0 || allVisibleSelected
                ? "not-allowed"
                : "pointer",
            fontSize: 13,
            fontWeight: 700,
            opacity: filtered.length === 0 ? 0.62 : 1,
          }}
        >
          Seleccionar visibles
        </button>

        <button
          onClick={handleClearSelection}
          disabled={selectedCustomerIds.length === 0}
          style={{
            padding: "9px 12px",
            borderRadius: 999,
            border: "1px solid rgba(148,163,184,0.34)",
            background: "rgba(255,255,255,0.82)",
            color: "#334155",
            cursor:
              selectedCustomerIds.length === 0 ? "not-allowed" : "pointer",
            fontSize: 13,
            fontWeight: 700,
            opacity: selectedCustomerIds.length === 0 ? 0.62 : 1,
          }}
        >
          Limpiar selección
        </button>
      </div>

      <div
        style={{
          marginTop: 16,
          border: "1px solid rgba(148,163,184,0.18)",
          borderRadius: 20,
          overflow: "hidden",
          background: "rgba(255,255,255,0.86)",
          boxShadow: "0 16px 32px rgba(15,23,42,0.06)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1180 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "44px 2fr 1.5fr 0.7fr 1fr 1fr 0.8fr 1fr 128px",
                padding: 14,
                fontSize: 12,
                fontWeight: 800,
                color: "#64748b",
                background: "#f8fafc",
              }}
            >
              <div>Sel.</div>
              <div>Cliente</div>
              <div>Contacto</div>
              <div>Citas</div>
              <div>Última cita</div>
              <div>Total pagado</div>
              <div>Pendientes</div>
              <div>Estado</div>
              <div>Acciones</div>
            </div>

            {filtered.map((c) => {
              const hasEmail = !!c.email?.trim();
              const hasPhone = !!c.phone?.trim();
              const customerStatus = getCustomerVisualStatus(c);
              const hasPendingPayments = Number(c.stats?.pending_payments ?? 0) > 0;
              const isSelected = selectedCustomerIds.includes(c.id);
              const lastAppointment = c.stats?.last_appointment_at
                ? formatCreatedAt(c.stats.last_appointment_at)
                : "Sin citas";

              return (
                <div
                  key={c.id}
                  onClick={() => router.push(`/admin/customers/${c.id}`)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px 2fr 1.5fr 0.7fr 1fr 1fr 0.8fr 1fr 128px",
                    padding: 14,
                    borderTop: "1px solid #e2e8f0",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    background: isSelected ? "#f8fafc" : "transparent",
                    transition: "background 120ms ease",
                  }}
                >
                  <label
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    title={
                      isSelected
                        ? "Quitar de la campaña"
                        : "Agregar a la campaña"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleCustomerSelection(c.id)}
                      style={{
                        width: 18,
                        height: 18,
                        accentColor: "#0f172a",
                        cursor: "pointer",
                      }}
                    />
                  </label>

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 800,
                        color: "#0f172a",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.full_name}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        color: "#64748b",
                      }}
                    >
                      {generateCustomerCode(c.id)}
                    </div>
                    <div
                      title={c.notes ?? ""}
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: c.notes ? "#64748b" : "#94a3b8",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.notes?.trim() ? c.notes.trim() : "Sin notas"}
                    </div>
                  </div>

                  <div style={{ fontSize: 13, color: "#334155" }}>
                    <div>{c.phone ?? "Sin teléfono"}</div>
                    <div
                      style={{
                        marginTop: 4,
                        color: hasEmail ? "#64748b" : "#94a3b8",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.email ?? "Sin email"}
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#334155",
                    }}
                  >
                    {c.stats?.appointment_count ?? 0}
                  </div>

                  <div style={{ fontSize: 13, color: "#334155" }}>
                    {lastAppointment}
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                    {formatMoney(c.stats?.total_paid)}
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 800, color: (c.stats?.pending_payments ?? 0) > 0 ? "#92400e" : "#64748b" }}>
                    {c.stats?.pending_payments ?? 0}
                  </div>

                  <div>
                    <CustomerStatusBadge status={customerStatus} />
                    {hasPendingPayments ? (
                      <div style={{ marginTop: 6 }}>
                        <StatusBadge tone="amber">Tiene pagos pendientes</StatusBadge>
                      </div>
                    ) : null}
                    <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>
                      Alta: {formatCreatedAt(c.created_at)}
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(c);
                      setUpsertOpen(true);
                    }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                      background: "white",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Editar
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {!loading && customers.length === 0 && (
          <div style={{ padding: 28, borderTop: "1px solid #e2e8f0" }}>
            <EmptyState
              title="Todavía no tienes clientes registrados"
              description="Cuando alguien reserve una hora, aparecerá automáticamente aquí. También puedes crear un cliente manualmente."
              actionLabel="Crear cliente"
              actionHref="/admin/customers/new"
            />
          </div>
        )}

        {!loading && customers.length > 0 && filtered.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: "#64748b" }}>
            No se encontraron clientes con estos filtros.
          </div>
        )}
      </div>

      {bulkOpen && (
        <div
          onClick={() => setBulkOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            zIndex: 90,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(760px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              borderRadius: 22,
              background: "white",
              border: "1px solid rgba(148,163,184,0.22)",
              boxShadow: "0 24px 60px rgba(15,23,42,0.22)",
              padding: 22,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a" }}>
                  Nuevo mensaje
                </div>
                <div style={{ marginTop: 6, fontSize: 14, color: "#64748b" }}>
                  La campaña se enviará a automatización para procesar el canal seleccionado.
                </div>
              </div>

              <button
                onClick={() => setBulkOpen(false)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  background: "white",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cerrar
              </button>
            </div>

            <div
              style={{
                marginTop: 18,
                display: "grid",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                    Canal
                  </span>
                  <select
                    value={bulkChannel}
                    onChange={(e) => {
                      setBulkChannel(e.target.value as BulkChannel);
                      setBulkSuccess("");
                    }}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      background: "white",
                    }}
                  >
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp manual</option>
                    <option value="both">Ambos</option>
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                    Destinatarios
                  </span>
                  <select
                    value={bulkAudience}
                    onChange={(e) => {
                      setBulkAudience(e.target.value as BulkAudience);
                      setBulkSuccess("");
                    }}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      background: "white",
                    }}
                  >
                    <option value="all">Todos los clientes</option>
                    <option value="email">Solo clientes con email</option>
                    <option value="phone">Solo clientes con teléfono</option>
                  </select>
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    {selectedCustomerIds.length > 0
                      ? `Seleccionados (${selectedCustomerIds.length})`
                      : "Todos los clientes"}
                  </span>
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  Asunto / título
                </span>
                <input
                  value={bulkSubject}
                  onChange={(e) => {
                    setBulkSubject(e.target.value);
                    setBulkSuccess("");
                  }}
                  placeholder="Ej: Novedades, promoción o recordatorio"
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #cbd5e1",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  Imagen / banner opcional
                </span>
                <input
                  value={campaignImageUrl}
                  onChange={(e) => {
                    setCampaignImageUrl(e.target.value);
                    setBulkSuccess("");
                  }}
                  placeholder="https://..."
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #cbd5e1",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  Mensaje
                </span>
                <textarea
                  value={bulkMessage}
                  onChange={(e) => {
                    setBulkMessage(e.target.value);
                    setBulkSuccess("");
                  }}
                  placeholder="Escribe aquí el contenido del mensaje..."
                  style={{
                    minHeight: 140,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #cbd5e1",
                    resize: "vertical",
                  }}
                />
              </label>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    padding: 16,
                    borderRadius: 16,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                    {selectedCustomerIds.length > 0
                      ? `Seleccionados (${selectedCustomerIds.length})`
                      : "Todos los clientes"}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 28, fontWeight: 800 }}>
                    {bulkRecipients.length}
                  </div>
                </div>

                <div
                  style={{
                    padding: 16,
                    borderRadius: 16,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                    Canal seleccionado
                  </div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 800 }}>
                    {bulkChannel === "email"
                      ? "Email"
                      : bulkChannel === "whatsapp"
                        ? "WhatsApp manual"
                        : "Ambos"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                Preview payload:
                <pre
                  style={{
                    margin: "10px 0 0 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 11,
                    color: "#0f172a",
                  }}
                >
                  {JSON.stringify(
                    {
                      ...bulkPayload,
                      recipients: bulkPayload.recipients.slice(0, 3),
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>

              {bulkError ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #fecaca",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {bulkError}
                </div>
              ) : null}

              {bulkSuccess ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #bbf7d0",
                    background: "#f0fdf4",
                    color: "#15803d",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {bulkSuccess}
                </div>
              ) : null}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => setBulkOpen(false)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #cbd5e1",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Cancelar
                </button>

                <button
                  onClick={() => void handleSendBulkMessage()}
                  disabled={bulkSending}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 14,
                    border: "1px solid #111827",
                    background: bulkSending ? "#475569" : "#111827",
                    color: "white",
                    cursor: bulkSending ? "not-allowed" : "pointer",
                    fontWeight: 700,
                    opacity: bulkSending ? 0.82 : 1,
                  }}
                >
                  {bulkSending ? "Enviando..." : "Enviar campaña"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
      </div>
    </main>
  );
}
