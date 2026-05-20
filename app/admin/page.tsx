"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Megaphone,
  ReceiptText,
  Settings,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";

import AdminNav from "@/components/admin/AdminNav";
import {
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

type PriorityAlert = {
  id: string;
  title: string;
  count: number;
  description: string;
  href?: string;
  actionLabel?: string;
  severity: "success" | "info" | "warning" | "danger" | "neutral";
  icon: ComponentType<{ className?: string }>;
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

function formatFriendlyDate(value: Date) {
  return value.toLocaleDateString("es-CL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Santiago",
  });
}

function formatTime(value: string | null) {
  if (!value) return "Sin hora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin hora";
  return date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  });
}

function initials(value: string | null) {
  const safe = value?.trim() || "Cliente";
  const parts = safe.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "C"}${parts[1]?.[0] ?? ""}`.toUpperCase();
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

function isPendingAppointment(row: AppointmentDashboardRow) {
  const bookingStatus = String(row.booking_status ?? "").toLowerCase();
  const status = String(row.status ?? "").toLowerCase();
  return bookingStatus === "pending" || status === "pending";
}

function hasPaymentInfo(row: AppointmentDashboardRow) {
  return (
    Boolean(row.payment_status) ||
    moneyNumber(row.payment_paid_amount) > 0 ||
    moneyNumber(row.payment_remaining_amount) > 0 ||
    moneyNumber(row.payment_required_amount) > 0
  );
}

function isCreatedThisWeek(value: string | null | undefined, nowMs: number) {
  if (!value) return false;
  const createdAt = new Date(value).getTime();
  if (!Number.isFinite(createdAt)) return false;

  const now = new Date(nowMs);
  const weekStart = new Date(now);
  const day = weekStart.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  return createdAt >= weekStart.getTime() && createdAt <= nowMs;
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

const severityStyles: Record<
  PriorityAlert["severity"],
  {
    icon: string;
    badge: string;
    dot: string;
    label: string;
  }
> = {
  success: {
    icon: "border-emerald-200 bg-emerald-50 text-emerald-700",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
    label: "Al día",
  },
  info: {
    icon: "border-sky-200 bg-sky-50 text-sky-700",
    badge: "border-sky-200 bg-sky-50 text-sky-700",
    dot: "bg-sky-500",
    label: "Revisar",
  },
  warning: {
    icon: "border-amber-200 bg-amber-50 text-amber-800",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    label: "Pendiente",
  },
  danger: {
    icon: "border-red-200 bg-red-50 text-red-700",
    badge: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-red-500",
    label: "Urgente",
  },
  neutral: {
    icon: "border-slate-200 bg-slate-50 text-slate-600",
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
    label: "Info",
  },
};

const metricCards = [
  {
    key: "today",
    label: "Reservas de hoy",
    icon: CalendarDays,
    tone: "blue",
  },
  {
    key: "upcoming",
    label: "Confirmadas próximas",
    icon: CheckCircle2,
    tone: "green",
  },
  {
    key: "pendingPayments",
    label: "Pagos pendientes",
    icon: CreditCard,
    tone: "amber",
  },
  {
    key: "customers",
    label: "Clientes registrados",
    icon: Users,
    tone: "slate",
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
  const [nowMs] = useState(() => Date.now());

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
    const now = nowMs;
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
  }, [appointments, nowMs]);

  const priorityAlerts = useMemo<PriorityAlert[]>(() => {
    const pendingAppointments = appointments.filter(isPendingAppointment).length;
    const newCustomersThisWeek = customers.filter((customer) =>
      isCreatedThisWeek(customer.created_at, nowMs),
    ).length;

    const alerts: PriorityAlert[] = [];

    if (metrics.pendingPayments > 0) {
      alerts.push({
        id: "pending-payments",
        title: "Pagos pendientes",
        count: metrics.pendingPayments,
        description: "Clientes con cobros pendientes.",
        href: "/admin/pagos",
        actionLabel: "Ver pagos",
        severity: "warning",
        icon: CreditCard,
      });
    }

    if (pendingAppointments > 0) {
      alerts.push({
        id: "pending-appointments",
        title: "Reservas pendientes",
        count: pendingAppointments,
        description: "Citas que requieren confirmacion.",
        href: "/admin/agenda",
        actionLabel: "Ver agenda",
        severity: "info",
        icon: CalendarDays,
      });
    }

    if (metrics.today > 0) {
      alerts.push({
        id: "today-appointments",
        title: "Citas de hoy",
        count: metrics.today,
        description: "Reservas programadas para hoy.",
        href: "/admin/agenda",
        actionLabel: "Ver agenda",
        severity: "neutral",
        icon: Clock,
      });
    }

    if (newCustomersThisWeek > 0) {
      alerts.push({
        id: "new-customers",
        title: "Clientes nuevos",
        count: newCustomersThisWeek,
        description: "Nuevos clientes esta semana.",
        href: "/admin/customers",
        actionLabel: "Ver clientes",
        severity: "success",
        icon: Users,
      });
    }

    return alerts;
  }, [appointments, customers, metrics.pendingPayments, metrics.today, nowMs]);

  const todayAppointments = useMemo(() => {
    const today = dayKey(new Date());
    return appointments
      .filter((row) => {
        const start = row.start_at ? new Date(row.start_at) : null;
        return start && dayKey(start) === today;
      })
      .sort(
        (a, b) =>
          new Date(a.start_at || 0).getTime() -
          new Date(b.start_at || 0).getTime(),
      )
      .slice(0, 5);
  }, [appointments]);

  const recentPayments = useMemo(() => {
    return appointments
      .filter(hasPaymentInfo)
      .sort(
        (a, b) =>
          new Date(b.start_at || 0).getTime() -
          new Date(a.start_at || 0).getTime(),
      )
      .slice(0, 5);
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
        eyebrow="Resumen operativo"
        title="Resumen de hoy"
        description="Estado operativo de tu agenda, clientes y pagos."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black capitalize text-slate-600 shadow-sm">
              {formatFriendlyDate(new Date())}
            </div>
            <Link
              href="/admin/agenda"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
            >
              Ver agenda
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      <section className="mt-5 rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black uppercase text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              Citaya Pro
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">
              Operación lista para atender
            </h2>
            <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500">
              Revisa lo importante sin entrar a cada módulo: reservas, cobros y actividad reciente.
            </p>
          </div>
          <div className="grid gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <span className="text-xs font-black uppercase text-slate-500">Ingresos estimados</span>
            <span className="text-2xl font-black text-slate-950">
              {loading ? "..." : formatCLP(metrics.estimatedIncome)}
            </span>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((metric) => {
          const Icon = metric.icon;
          const value =
            metric.key === "today"
              ? metrics.today
              : metric.key === "upcoming"
                ? metrics.upcoming
                : metric.key === "pendingPayments"
                  ? metrics.pendingPayments
                  : customers.length;

          const hint =
            metric.key === "today"
              ? "Agenda del día"
              : metric.key === "upcoming"
                ? "Reservas confirmadas"
                : metric.key === "pendingPayments"
                  ? "Requieren seguimiento"
                  : "Base activa";

          return (
            <div
              key={metric.key}
              className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase text-slate-500">
                    {metric.label}
                  </div>
                  <div className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                    {loading ? "..." : value}
                  </div>
                </div>
                <div className="grid h-11 w-11 place-items-center rounded-2xl border border-blue-200 bg-blue-50 text-blue-600 shadow-sm transition group-hover:bg-blue-600 group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-500">
                <span
                  className={`h-2 w-2 rounded-full ${
                    metric.tone === "green"
                      ? "bg-emerald-500"
                      : metric.tone === "amber"
                        ? "bg-amber-500"
                        : "bg-blue-500"
                  }`}
                />
                {hint}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <AdminSectionCard
          title="Agenda del día"
          description={`Reservas visibles para ${tenantSlug || "tu negocio"}.`}
          actions={
            <Link
              href="/admin/agenda"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Ver agenda completa
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          }
        >
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500">
              Cargando agenda...
            </div>
          ) : todayAppointments.length === 0 ? (
            <EmptyState
              title="No hay reservas para hoy"
              description="Cuando entren citas del día, aparecerán ordenadas por hora."
              icon={CalendarDays}
            />
          ) : (
            <div className="grid gap-3">
              {todayAppointments.map((row) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-300 hover:bg-white"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid h-12 w-16 shrink-0 place-items-center rounded-2xl border border-blue-200 bg-blue-50 text-sm font-black text-blue-700">
                        {formatTime(row.start_at)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-base font-black text-slate-950">
                          {row.customer_name || "Cliente"}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-500">
                          <span>{row.service_name || "Servicio"}</span>
                          <span className="hidden sm:inline">·</span>
                          <span>{row.payment_status ? "Con pago asociado" : "Sin pago asociado"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <StatusBadge status={row.status || row.booking_status} />
                      {row.payment_status ? <StatusBadge status={row.payment_status} /> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminSectionCard>

        <div className="grid gap-4">
          <AdminSectionCard
            title="Pagos recientes"
            description="Cobros detectados desde las reservas."
            actions={
              <Link
                href="/admin/pagos"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Ver pagos
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            }
          >
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500">
                Cargando pagos...
              </div>
            ) : recentPayments.length === 0 ? (
              <EmptyState
                title="Sin pagos recientes"
                description="Los pagos asociados a reservas aparecerán aquí."
                icon={ReceiptText}
              />
            ) : (
              <div className="grid gap-3">
                {recentPayments.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:border-blue-300 hover:bg-white"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-black text-white">
                        {initials(row.customer_name)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-black text-slate-950">
                          {row.customer_name || "Cliente"}
                        </div>
                        <div className="mt-1 text-xs font-medium text-slate-500">
                          {formatActivityDate(row.start_at)}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-black text-slate-950">
                        {formatCLP(
                          moneyNumber(row.payment_paid_amount) ||
                            moneyNumber(row.payment_required_amount) ||
                            moneyNumber(row.payment_remaining_amount),
                        )}
                      </div>
                      <div className="mt-1 flex justify-end">
                        <StatusBadge status={row.payment_status || row.booking_status || row.status} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AdminSectionCard>

          <AdminSectionCard title="Acciones rápidas" description={`Atajos frecuentes para ${tenantSlug || "tu negocio"}.`}>
            <div className="grid gap-3">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="group rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm transition hover:border-blue-300 hover:bg-white"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white transition group-hover:scale-105">
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
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <AdminSectionCard title="Actividad reciente" description="Últimos movimientos relevantes del negocio.">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500">
              Cargando actividad...
            </div>
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
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:bg-white sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-black text-slate-950">{item.title}</div>
                      <div className="mt-1 text-sm font-medium text-slate-500">
                        {item.description} · {formatActivityDate(item.date)}
                      </div>
                    </div>
                  </div>
                  {item.status ? <StatusBadge status={item.status} /> : null}
                </div>
              ))}
            </div>
          )}
        </AdminSectionCard>

        <AdminSectionCard
          title="Prioridades de hoy"
          description="Alertas rápidas para saber dónde actuar primero."
          className="overflow-hidden border-blue-200/70"
        >
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500">
              Revisando alertas del negocio...
            </div>
          ) : priorityAlerts.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-emerald-200 bg-white text-emerald-700 shadow-sm">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-base font-black text-slate-950">Todo en orden</div>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      No hay alertas críticas por ahora. Revisa tu agenda o prepara una campaña para tus clientes.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href="/admin/agenda"
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Ver agenda
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/admin/campanas"
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                  >
                    Crear campaña
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {priorityAlerts.map((alert) => {
                const Icon = alert.icon;
                const styles = severityStyles[alert.severity];

                const content = (
                  <div className="group h-full rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm transition hover:border-blue-300 hover:bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${styles.icon}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-950">{alert.title}</div>
                          <p className="mt-1 text-sm font-medium text-slate-500">{alert.description}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-3xl font-black leading-none tracking-tight text-slate-950">
                          {alert.count}
                        </div>
                        <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${styles.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                          {styles.label}
                        </span>
                      </div>
                    </div>
                    {alert.href && alert.actionLabel ? (
                      <div className="mt-4 inline-flex items-center gap-1 text-sm font-black text-blue-600 transition group-hover:text-blue-700">
                        {alert.actionLabel}
                        <ArrowUpRight className="h-4 w-4" />
                      </div>
                    ) : null}
                  </div>
                );

                return alert.href ? (
                  <Link key={alert.id} href={alert.href} className="block min-w-0">
                    {content}
                  </Link>
                ) : (
                  <div key={alert.id} className="min-w-0">
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </AdminSectionCard>
      </div>
    </AdminPageShell>
  );
}
