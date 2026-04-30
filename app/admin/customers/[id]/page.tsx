"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import AdminNav from "@/components/admin/AdminNav";
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  CustomerStatusBadge,
  EmptyState,
  StatusBadge,
  getCustomerVisualStatus,
} from "@/components/admin/admin-ui";
import { toast } from "@/components/ui/use-toast";

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
  booking_status: string | null;
  payment_status: string | null;
  payment_required_amount: number | null;
  payment_paid_amount: number | null;
  payment_provider: string | null;
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

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  return amount.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
}

function statusTone(
  value: string | null | undefined,
): "slate" | "green" | "amber" | "red" {
  const status = String(value ?? "").toLowerCase();
  if (status === "paid" || status === "confirmed" || status === "completed") return "green";
  if (status === "pending" || status === "pending_payment") return "amber";
  if (status === "failed" || status === "canceled" || status === "cancelled") return "red";
  return "slate";
}

function statusLabel(value: string | null | undefined) {
  const status = String(value ?? "").toLowerCase();
  if (status === "paid") return "Pago aprobado";
  if (status === "pending" || status === "pending_payment") return "Pago pendiente";
  if (status === "failed") return "Pago fallido";
  if (status === "confirmed") return "Cita confirmada";
  if (status === "completed") return "Cita completada";
  if (status === "canceled" || status === "cancelled") return "Cita cancelada";
  return value || "Sin estado";
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
  const totalPaid = appointments.reduce(
    (sum, a) => sum + Number(a.payment_paid_amount ?? 0),
    0,
  );
  const pendingPayments = appointments.filter((a) => {
    const status = String(a.payment_status ?? "").toLowerCase();
    return status === "pending" || status === "pending_payment";
  }).length;
  const cancellations = appointments.filter((a) => {
    const status = String(a.booking_status ?? a.status ?? "").toLowerCase();
    return status === "canceled" || status === "cancelled";
  }).length;

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
      toast({ title: "No se pudo cargar el cliente", variant: "destructive" });
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
      toast({ title: "El nombre es obligatorio", variant: "destructive" });
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
      toast({ title: "Error guardando cambios", description: error.message, variant: "destructive" });
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
      toast({ title: "Error eliminando cliente", description: error.message, variant: "destructive" });
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
      <main className="p-6 text-sm text-slate-500">
        <p>Cargando cliente...</p>
      </main>
    );
  }

  const customerVisualStatus = getCustomerVisualStatus({
    created_at: customer?.created_at,
    stats: {
      appointment_count: summary?.totalAppointments ?? appointments.length,
      last_appointment_at: summary?.lastVisit?.start_at ?? null,
    },
  });

  return (
    <AdminPageShell width="wide">
      <AdminNav />
      <AdminPageHeader
        eyebrow={customer ? generateCustomerCode(customer.id) : "Ficha cliente"}
        title={customer?.full_name ?? "Cliente"}
        description={`${customer?.email || "Sin email"} · ${customer?.phone || "Sin teléfono"} · Alta: ${formatDate(customer?.created_at)}`}
        actions={
          <Link href="/admin/customers" className="rounded-xl border bg-white px-3 py-2 text-sm font-bold text-slate-700">
            Volver
          </Link>
        }
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <CustomerStatusBadge status={customerVisualStatus} />
        {pendingPayments > 0 ? <StatusBadge tone="amber">Tiene pagos pendientes</StatusBadge> : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <AdminKpiCard label="Total citas" value={summary?.totalAppointments ?? 0} />
        <AdminKpiCard
          label="Ultima cita"
          value={summary?.lastVisit ? formatDate(summary.lastVisit.start_at) : "No disponible"}
          hint={summary?.lastVisit ? formatTime(summary.lastVisit.start_at) : undefined}
          tone="blue"
        />
        <AdminKpiCard
          label="Proxima cita"
          value={summary?.upcoming ? formatDate(summary.upcoming.start_at) : "No disponible"}
          hint={summary?.upcoming ? formatTime(summary.upcoming.start_at) : undefined}
        />
        <AdminKpiCard label="Total pagado" value={formatMoney(totalPaid)} tone="green" />
        <AdminKpiCard label="Pagos pendientes" value={pendingPayments} tone="amber" />
        <AdminKpiCard label="Fallidas/canceladas" value={cancellations} tone={cancellations > 0 ? "red" : "default"} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <AdminSectionCard title="Timeline del historial">
          {appointments.length === 0 ? (
            <EmptyState title="Sin historial" description="Este cliente aun no tiene citas asociadas." />
          ) : (
            <div className="space-y-3">
              {appointments.map((appt) => {
                const booking = appt.booking_status || appt.status;
                return (
                  <div key={appt.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-black text-slate-950">{appt.service_name || "Servicio"}</div>
                        <div className="mt-1 text-sm font-medium text-slate-500">
                          {formatDate(appt.start_at)} · {formatTime(appt.start_at)} - {formatTime(appt.end_at)}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {appt.professional_name || "Sin profesional asignado"}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone={statusTone(booking)}>{statusLabel(booking)}</StatusBadge>
                        <StatusBadge tone={statusTone(appt.payment_status)}>{statusLabel(appt.payment_status)}</StatusBadge>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                      <div>
                        <span className="font-bold text-slate-800">Pagado:</span> {formatMoney(appt.payment_paid_amount)}
                      </div>
                      <div>
                        <span className="font-bold text-slate-800">Requerido:</span> {formatMoney(appt.payment_required_amount)}
                      </div>
                      <div>
                        <span className="font-bold text-slate-800">Proveedor:</span> {appt.payment_provider || "Sin proveedor"}
                      </div>
                    </div>
                    {appt.notes?.trim() ? (
                      <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600">{appt.notes}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </AdminSectionCard>

        <div className="grid gap-4">
          <AdminSectionCard title="Notas internas" description="Placeholder visual">
            {/* TODO: crear tabla customer_notes con tenant_id, customer_id, body, created_by y created_at. */}
            <EmptyState
              title="Sin notas internas"
              description="Aqui se podran registrar preferencias, restricciones y contexto privado del cliente."
            />
          </AdminSectionCard>

          <AdminSectionCard title="Campañas / etiquetas" description="Placeholder visual">
            {/* TODO: crear tablas customer_tags y campaign_audiences para segmentacion CRM multi-tenant. */}
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="blue">Promo futura</StatusBadge>
              <StatusBadge tone="green">Cliente frecuente</StatusBadge>
              <StatusBadge tone="amber">Reactivar</StatusBadge>
            </div>
          </AdminSectionCard>
        </div>
      </div>

      <AdminSectionCard className="mt-5" title="Editar ficha">
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-bold text-slate-700">
            Nombre *
            <input className="rounded-xl border border-slate-200 px-3 py-2" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              Telefono
              <input className="rounded-xl border border-slate-200 px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej: 956655664" />
            </label>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              Correo
              <input className="rounded-xl border border-slate-200 px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-bold text-slate-700">
            Notas
            <textarea className="min-h-24 rounded-xl border border-slate-200 px-3 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button onClick={onSave} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60">
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
            <button onClick={onDelete} disabled={deleting} className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-700 disabled:opacity-60">
              {deleting ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
          <p className="text-xs font-medium text-slate-500">
            Nota: si el cliente tiene citas relacionadas, las citas quedan y el customer_id se limpia por la FK actual.
          </p>
        </div>
      </AdminSectionCard>
    </AdminPageShell>
  );
}
