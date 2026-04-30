"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminPageShellProps = {
  children: ReactNode;
  className?: string;
  width?: "normal" | "wide" | "narrow";
};

const widths = {
  narrow: "max-w-4xl",
  normal: "max-w-6xl",
  wide: "max-w-7xl",
};

export function AdminPageShell({
  children,
  className,
  width = "wide",
}: AdminPageShellProps) {
  return (
    <main className="min-h-screen bg-[#f6f7fb] p-4 text-slate-950 sm:p-6">
      <div className={cn("mx-auto min-w-0", widths[width], className)}>
        {children}
      </div>
    </main>
  );
}

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function AdminKpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "green" | "amber" | "blue" | "red";
}) {
  const toneClass = {
    default: "border-slate-200 bg-white",
    green: "border-emerald-100 bg-emerald-50/70",
    amber: "border-amber-100 bg-amber-50/70",
    blue: "border-sky-100 bg-sky-50/70",
    red: "border-red-100 bg-red-50/70",
  }[tone];

  return (
    <div className={cn("rounded-2xl border p-4 shadow-sm", toneClass)}>
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
      {hint ? <div className="mt-1 text-xs font-medium text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function AdminSectionCard({
  title,
  description,
  children,
  actions,
  className,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white shadow-sm", className)}>
      {title || description || actions ? (
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title ? <h2 className="font-black text-slate-950">{title}</h2> : null}
            {description ? (
              <p className="mt-1 text-sm font-medium text-slate-500">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <div className="text-lg font-black text-slate-950">{title}</div>
      {description ? (
        <div className="mx-auto mt-2 max-w-md text-sm font-medium text-slate-500">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "slate",
  className,
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "amber" | "red" | "blue" | "dark";
  className?: string;
}) {
  const toneClass = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-sky-200 bg-sky-50 text-sky-700",
    dark: "border-slate-900 bg-slate-900 text-white",
  }[tone];

  return (
    <span className={cn("inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-black", toneClass, className)}>
      {children}
    </span>
  );
}

export type CustomerVisualStatus = "new" | "recurring" | "inactive";

export function getCustomerVisualStatus(input: {
  created_at?: string | null;
  stats?: { appointment_count?: number; last_appointment_at?: string | null };
}): CustomerVisualStatus {
  const appointmentCount = Number(input.stats?.appointment_count ?? 0);
  if (appointmentCount >= 2) return "recurring";

  const lastDate = input.stats?.last_appointment_at ?? input.created_at;
  if (lastDate) {
    const ts = new Date(lastDate).getTime();
    const inactiveAfterMs = 1000 * 60 * 60 * 24 * 90;
    if (Number.isFinite(ts) && Date.now() - ts > inactiveAfterMs) return "inactive";
  }

  return "new";
}

export function CustomerStatusBadge({
  status,
}: {
  status: CustomerVisualStatus;
}) {
  if (status === "recurring") return <StatusBadge tone="green">Recurrente</StatusBadge>;
  if (status === "inactive") return <StatusBadge tone="amber">Inactivo</StatusBadge>;
  return <StatusBadge tone="blue">Nuevo</StatusBadge>;
}
