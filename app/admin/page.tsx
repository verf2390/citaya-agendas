"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CreditCard,
  Megaphone,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  EmptyState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type AppointmentDashboardRow = {
  id: string;
  customer_name: string | null;
  service_name: string | null;
  start_at: string | null;
  status: string | null;
  booking_status: string | null;
  payment_status: string | null;
  payment_paid_amount: number | null;
  payment_remaining_amount: number | null;
  payment_required_amount: number | null;
};

type CustomerDashboardRow = {
  id: string;
  full_name: string;
  created_at?: string | null;
};

type ActivityItem = {
  id: string;
  title: string;
  description: string;
  date: string | null;
  status?: string | null;
};

function moneyNumber(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function formatCLP(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return value.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
}

function dayKey(value: Date) {
  return value.toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

function formatActivityDate(value: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isPendingPayment(row: AppointmentDashboardRow) {
  const paymentStatus = String(row.payment_status ?? "").toLowerCase();
  const bookingStatus = String(row.booking_status ?? "").toLowerCase();
  const status = String(row.status ?? "").toLowerCase();
  return (
    paymentStatus === "pending" ||
    paymentStatus === "failed" ||
    paymentStatus === "pending_payment" ||
    bookingStatus === "pending_payment" ||
    status === "pending_payment"
  );
}

const quickActions = [
  {
    title: "Nueva cita",
    description: "Agenda una reserva desde el panel.",
    href: "/admin/agenda",
    icon: CalendarDays,
  },
  {
    title: "Nuevo cliente",
    description: "Crea un cliente manualmente.",
    href: "/admin/customers/new",
    icon: UserPlus,
  },
  {
    title: "Ver pagos",
    description: "Revisa pagos y cobros pendientes.",
    href: "/admin/pagos",
    icon: CreditCard,
  },
  {
    title: "Crear campaña",
    description: "Envía una campaña segmentada.",
    href: "/admin/campanas",
    icon: Megaphone,
  },
  {
    title: "Configurar negocio",
    description: "Actualiza datos visibles del negocio.",
    href: "/admin/configuracion",
    icon: Settings,
  },
] as const;

export default function AdminDashboardPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<AppointmentDashboardRow[]>([]);
  const [customers, setCustomers] = useState<CustomerDashboardRow[]>([]);

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
        setTenantError(error?.message ?? `No existe negocio para ${slug}`);
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
        router.push(`/login?redirectTo=${encodeURIComponent("/admin")}`);
        return;
      }
      setAuthChecked(true);
    };

    void run();
  }, [router, tenantId, tenantError]);

  useEffect(() => {
    const load = async () => {
      if (!authChecked || !tenantId) return;
      setLoading(true);

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      const params = new URLSearchParams({
        tenantId,
        start: "2000-01-01T00:00:00.000Z",
        end: "2100-01-01T00:00:00.000Z",
      });

      const [appointmentsRes, customersRes] = await Promise.all([
        fetch(`/api/admin/appointments/range?${params.toString()}`, {
          cache: "no-store",
        }),
        token
          ? fetch(`/api/customers/list?tenantId=${tenantId}`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            })
          : Promise.resolve(null),
      ]);

      const appointmentsJson = await appointmentsRes.json().catch(() => null);
      if (appointmentsRes.ok && Array.isArray(appointmentsJson?.items)) {
        setAppointments(appointmentsJson.items as AppointmentDashboardRow[]);
      } else {
        setAppointments([]);
      }

      if (customersRes) {
        const customersJson = await customersRes.json().catch(() => null);
        if (customersRes.ok && Array.isArray(customersJson?.customers)) {
          setCustomers(customersJson.customers as CustomerDashboardRow[]);
        } else {
          setCustomers([]);
        }
      } else {
        setCustomers([]);
      }

      setLoading(false);
    };

    void load();
  }, [authChecked, tenantId]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const today = dayKey(new Date());

    return appointments.reduce(
      (acc, row) => {
        const start = row.start_at ? new Date(row.start_at) : null;
        const startMs = start?.getTime() ?? Number.NaN;
        const status = String(row.status ?? row.booking_status ?? "").toLowerCase();

        if (start && dayKey(start) === today) acc.today += 1;
        if (Number.isFinite(startMs) && startMs > now && status === "confirmed") {
          acc.upcoming += 1;
        }
        if (isPendingPayment(row)) acc.pendingPayments += 1;

        const paid = moneyNumber(row.payment_paid_amount);
        const pending =
          isPendingPayment(row) &&
          (moneyNumber(row.payment_remaining_amount) ||
            moneyNumber(row.payment_required_amount));
        acc.estimatedIncome += paid + moneyNumber(pending);

        return acc;
      },
      {
        today: 0,
        upcoming: 0,
        pendingPayments: 0,
        estimatedIncome: 0,
      },
    );
  }, [appointments]);

  const activity = useMemo<ActivityItem[]>(() => {
    const appointmentItems = appointments
      .filter((row) => row.start_at)
      .sort(
        (a, b) =>
          new Date(b.start_at || 0).getTime() -
          new Date(a.start_at || 0).getTime(),
      )
      .slice(0, 4)
      .map((row) => ({
        id: `appointment-${row.id}`,
        title: row.customer_name || "Reserva",
        description: row.service_name || "Nueva reserva",
        date: row.start_at,
        status: row.payment_status || row.status || row.booking_status,
      }));

    const customerItems = customers
      .filter((customer) => customer.created_at)
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime(),
      )
      .slice(0, 2)
      .map((customer) => ({
        id: `customer-${customer.id}`,
        title: customer.full_name,
        description: "Cliente registrado",
        date: customer.created_at ?? null,
        status: "active",
      }));

    return [...appointmentItems, ...customerItems]
      .sort(
        (a, b) =>
          new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
      )
      .slice(0, 6);
  }, [appointments, customers]);

  if (tenantError) {
    return <main className="p-6 text-sm text-red-700">{tenantError}</main>;
  }

  return (
    <AdminPageShell width="wide">
      <AdminNav />
      <AdminPageHeader
        eyebrow="Panel Pro"
        title="Panel de control"
        description="Revisa tus reservas, clientes, pagos y acciones importantes desde un solo lugar."
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <AdminKpiCard label="Citas de hoy" value={loading ? "..." : metrics.today} tone="blue" />
        <AdminKpiCard label="Próximas citas" value={loading ? "..." : metrics.upcoming} />
        <AdminKpiCard label="Pagos pendientes" value={loading ? "..." : metrics.pendingPayments} tone="amber" />
        <AdminKpiCard label="Clientes registrados" value={loading ? "..." : customers.length} tone="green" />
        <AdminKpiCard label="Ingresos estimados" value={loading ? "..." : formatCLP(metrics.estimatedIncome)} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <AdminSectionCard
          title="Acciones rápidas"
          description={`Atajos frecuentes para ${tenantSlug || "tu negocio"}.`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-black text-slate-950">{action.title}</div>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        {action.description}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </AdminSectionCard>

        <AdminSectionCard title="Actividad reciente">
          {loading ? (
            <div className="text-sm font-medium text-slate-500">Cargando actividad...</div>
          ) : activity.length === 0 ? (
            <EmptyState
              title="Todavía no hay actividad reciente"
              description="Las nuevas reservas, pagos y clientes aparecerán en este panel."
              icon={CalendarDays}
            />
          ) : (
            <div className="grid gap-2">
              {activity.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-black text-slate-950">{item.title}</div>
                    <div className="mt-1 text-sm font-medium text-slate-500">
                      {item.description} · {formatActivityDate(item.date)}
                    </div>
                  </div>
                  {item.status ? <StatusBadge status={item.status} /> : null}
                </div>
              ))}
            </div>
          )}
        </AdminSectionCard>
      </div>

      <AdminSectionCard
        className="mt-4"
        title="Esto es tu negocio hoy"
        description="Un resumen simple para tomar decisiones rápidas sin entrar a cada sección."
        actions={
          <Link
            href="/admin/agenda"
            className="rounded-xl border bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Ver agenda
          </Link>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900">
              <CalendarDays className="h-4 w-4" />
              Reservas
            </div>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Revisa la carga del día y las próximas citas confirmadas.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900">
              <Users className="h-4 w-4" />
              Clientes
            </div>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Mantén tu base ordenada para campañas y seguimiento.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900">
              <CreditCard className="h-4 w-4" />
              Cobros
            </div>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Detecta pagos pendientes y acciones de cobranza.
            </p>
          </div>
        </div>
      </AdminSectionCard>
    </AdminPageShell>
  );
}
