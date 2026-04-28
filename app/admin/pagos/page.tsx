"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/admin/AdminNav";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type PaymentFilter = "all" | "paid" | "pending" | "failed";

type AppointmentPayment = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  service_name: string | null;
  start_at: string | null;
  end_at: string | null;
  status: string | null;
  booking_status: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  payment_required: boolean | null;
  payment_required_amount: number | null;
  payment_paid_amount: number | null;
  payment_remaining_amount: number | null;
  payment_reference: string | null;
  payment_url: string | null;
  manage_token: string | null;
};

function formatCLP(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  return amount.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
}

function formatDateTime(value: string | null) {
  if (!value) return "No disponible";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No disponible";
  return d.toLocaleString("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });
}

function moneyNumber(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizedStatus(value: string | null | undefined) {
  return String(value ?? "").toLowerCase();
}

function hasPaymentInfo(row: AppointmentPayment) {
  return (
    row.payment_required === true ||
    Boolean(row.payment_status) ||
    moneyNumber(row.payment_required_amount) > 0 ||
    moneyNumber(row.payment_paid_amount) > 0 ||
    moneyNumber(row.payment_remaining_amount) > 0 ||
    Boolean(row.payment_url)
  );
}

function isPendingPayment(row: AppointmentPayment) {
  const paymentStatus = normalizedStatus(row.payment_status);
  const bookingStatus = normalizedStatus(row.booking_status);
  const status = normalizedStatus(row.status);

  return (
    paymentStatus === "pending" ||
    paymentStatus === "failed" ||
    bookingStatus === "pending_payment" ||
    status === "pending_payment"
  );
}

function paymentBadge(status: string | null | undefined) {
  const normalized = normalizedStatus(status);
  if (normalized === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "failed") return "border-red-200 bg-red-50 text-red-700";
  if (normalized === "pending" || normalized === "pending_payment") return "border-amber-200 bg-amber-50 text-amber-800";
  if (normalized === "not_required" || normalized === "pay_later") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function paymentLabel(status: string | null | undefined) {
  const normalized = normalizedStatus(status);
  if (normalized === "paid") return "Pagado";
  if (normalized === "failed") return "Pago fallido";
  if (normalized === "pending" || normalized === "pending_payment") return "Pago pendiente";
  if (normalized === "not_required" || normalized === "pay_later") return "Sin pago requerido";
  return "Sin estado";
}

export default function AdminPagosPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AppointmentPayment[]>([]);
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setTenantError("Este panel debe abrirse desde el subdominio del cliente.");
        setLoading(false);
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
        setLoading(false);
        return;
      }

      setTenantId(data.id);
    };

    void run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!tenantId || tenantError) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?redirectTo=${encodeURIComponent("/admin/pagos")}`);
        return;
      }
      setAuthChecked(true);
    };

    void run();
  }, [router, tenantId, tenantError]);

  const loadRows = async () => {
    if (!tenantId) return;
    setLoading(true);

    const params = new URLSearchParams({
      tenantId,
      start: "2000-01-01T00:00:00.000Z",
      end: "2100-01-01T00:00:00.000Z",
    });

    const res = await fetch(`/api/admin/appointments/range?${params.toString()}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !Array.isArray(json?.items)) {
      console.error("[admin/pagos] fetch appointments/range failed:", {
        status: res.status,
        body: json,
      });
      setRows([]);
    } else {
      const paymentRows = (json.items as AppointmentPayment[])
        .filter(hasPaymentInfo)
        .sort((a, b) => {
          const bTime = b.start_at ? new Date(b.start_at).getTime() : 0;
          const aTime = a.start_at ? new Date(a.start_at).getTime() : 0;
          return bTime - aTime;
        });
      setRows(paymentRows);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecked || !tenantId) return;
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, tenantId]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((row) => {
      const paymentStatus = normalizedStatus(row.payment_status);
      const bookingStatus = normalizedStatus(row.booking_status);
      const status = normalizedStatus(row.status);

      if (filter === "paid") return paymentStatus === "paid";
      if (filter === "failed") return paymentStatus === "failed";
      return (
        paymentStatus === "pending" ||
        bookingStatus === "pending_payment" ||
        status === "pending_payment"
      );
    });
  }, [rows, filter]);

  const kpis = useMemo(() => {
    const now = new Date();
    const todayKey = now.toLocaleDateString("en-CA", {
      timeZone: "America/Santiago",
    });
    const monthKey = todayKey.slice(0, 7);

    return rows.reduce(
      (acc, row) => {
        const paid = moneyNumber(row.payment_paid_amount);
        const remaining = moneyNumber(row.payment_remaining_amount);
        const status = normalizedStatus(row.payment_status);

        if (status === "paid") {
          acc.total += paid;
          const rowDate = row.start_at
            ? new Date(row.start_at).toLocaleDateString("en-CA", {
                timeZone: "America/Santiago",
              })
            : "";
          if (rowDate === todayKey) acc.today += paid;
          if (rowDate.slice(0, 7) === monthKey) acc.month += paid;
        }

        if (isPendingPayment(row)) {
          acc.pending += remaining;
        }

        return acc;
      },
      { today: 0, month: 0, total: 0, pending: 0 },
    );
  }, [rows]);

  const markAsPaid = async (appointmentId: string) => {
    setMarkingId(appointmentId);
    try {
      const res = await fetch("/api/admin/appointments/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId, paymentProvider: "manual" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        alert(json?.error ?? "No se pudo marcar como pagado");
        return;
      }
      await loadRows();
    } finally {
      setMarkingId(null);
    }
  };

  if (tenantError) {
    return <main className="p-6 text-sm text-red-700">{tenantError}</main>;
  }

  return (
    <main className="min-h-screen bg-[#f6f7fb] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <AdminNav />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-950">Pagos</h1>
            <p className="mt-1 text-sm text-slate-500">Tenant: {tenantSlug || "..."}</p>
          </div>
          <Link className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold" href="/admin/agenda">
            Volver a agenda
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Ingresos hoy", kpis.today],
            ["Ingresos mes", kpis.month],
            ["Total generado", kpis.total],
            ["Pagos pendientes", kpis.pending],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="text-xs font-bold text-slate-500">{label}</div>
              <div className="mt-2 text-2xl font-black text-slate-950">{formatCLP(Number(value))}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ["all", "Todos"],
            ["paid", "Pagados"],
            ["pending", "Pendientes"],
            ["failed", "Fallidos"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id as PaymentFilter)}
              className={`rounded-full border px-3 py-2 text-sm font-bold ${
                filter === id ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-700"
              }`}
              type="button"
            >
              {label}
            </button>
          ))}
          <button className="rounded-full border bg-white px-3 py-2 text-sm font-bold" onClick={() => void loadRows()} type="button">
            Recargar
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[1.4fr_1.2fr_1.2fr_1fr_1fr_1fr_1.6fr] gap-3 bg-slate-50 p-3 text-xs font-black text-slate-500">
                <div>Cliente</div>
                <div>Servicio</div>
                <div>Fecha/hora</div>
                <div>Pago</div>
                <div>Monto</div>
                <div>Reserva</div>
                <div>Acciones</div>
              </div>
              {loading ? (
                <div className="p-4 text-sm text-slate-500">Cargando pagos...</div>
              ) : filteredRows.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">No hay pagos para este filtro.</div>
              ) : (
                filteredRows.map((row) => (
                  <div key={row.id} className="grid grid-cols-[1.4fr_1.2fr_1.2fr_1fr_1fr_1fr_1.6fr] gap-3 border-t p-3 text-sm">
                    <div>
                      <div className="font-bold text-slate-900">{row.customer_name || "Cliente"}</div>
                      <div className="text-xs text-slate-500">{row.customer_email || "Sin email"}</div>
                    </div>
                    <div>{row.service_name || "Servicio"}</div>
                    <div>{formatDateTime(row.start_at)}</div>
                    <div>
                      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${paymentBadge(row.payment_status)}`}>
                        {paymentLabel(row.payment_status)}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">{row.payment_provider || "Sin proveedor"}</div>
                    </div>
                    <div>
                      <div className="font-bold">{formatCLP(row.payment_required_amount)}</div>
                      <div className="text-xs text-slate-500">Pagado {formatCLP(row.payment_paid_amount)}</div>
                    </div>
                    <div>
                      <div>{row.booking_status || row.status || "Sin estado"}</div>
                      {row.status && row.status !== row.booking_status ? (
                        <div className="text-xs text-slate-500">{row.status}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={markingId === row.id || normalizedStatus(row.payment_status) === "paid"}
                        onClick={() => void markAsPaid(row.id)}
                        className="rounded-xl border bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {markingId === row.id ? "Marcando..." : "Marcar como pagado"}
                      </button>
                      <button
                        type="button"
                        disabled={!row.payment_url}
                        onClick={() => {
                          if (row.payment_url) window.open(row.payment_url, "_blank", "noopener,noreferrer");
                        }}
                        className="rounded-xl border bg-white px-3 py-2 text-xs font-bold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        Abrir link de pago
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
