"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  Plug,
  Settings,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";

import { StatusBadge } from "@/components/admin/admin-ui";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

const ITEMS = [
  { href: "/admin", label: "Panel", icon: LayoutDashboard },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/admin/customers", label: "Clientes", icon: Users },
  { href: "/admin/pagos", label: "Pagos", icon: CreditCard },
  { href: "/admin/servicios", label: "Servicios", icon: Wrench },
  { href: "/admin/waitlist", label: "Waitlist", icon: Sparkles },
  { href: "/admin/campanas", label: "Campañas", icon: Megaphone },
  { href: "/admin/integraciones", label: "Integraciones", icon: Plug },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings },
];

type TenantHeader = {
  name: string;
  slug: string;
  logo_url?: string | null;
};

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "C";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase();
}

export default function AdminNav() {
  const pathname = usePathname();
  const [tenant, setTenant] = useState<TenantHeader | null>(null);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) return;

      const { data } = await supabase
        .from("tenants")
        .select("slug, name, logo_url")
        .eq("slug", slug)
        .maybeSingle();

      if (!data?.slug) return;
      setTenant({
        slug: data.slug,
        name: data.name?.trim() || data.slug,
        logo_url: data.logo_url ?? null,
      });
    };

    void run();
  }, []);

  const businessName = tenant?.name || "Citaya Admin";

  return (
    <div className="mb-5 grid gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 text-sm font-black text-white shadow-sm">
              {tenant?.logo_url ? (
                <img src={tenant.logo_url} alt={businessName} className="h-full w-full object-cover" />
              ) : (
                initials(businessName)
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-slate-950 sm:text-base">
                {businessName}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                <span>Agenda activa</span>
                <StatusBadge status="active" />
                <StatusBadge tone="dark">Citaya Pro</StatusBadge>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/agenda"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800"
            >
              <CalendarPlus className="h-4 w-4" />
              Nueva cita
            </Link>
            <Link
              href="/admin/campanas"
              className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50 sm:inline-flex"
            >
              Crear campaña
            </Link>
          </div>
        </div>
      </div>

      <nav className="rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-sm">
        <div className="flex min-w-max gap-1 overflow-x-auto lg:min-w-0 lg:flex-wrap">
          {ITEMS.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                    : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
