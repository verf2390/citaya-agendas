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
  ReceiptText,
  Settings,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";

import AdminLogoutButton from "@/components/admin/AdminLogoutButton";
import AdminThemeToggle from "@/components/admin/AdminThemeToggle";
import { StatusBadge } from "@/components/admin/admin-ui";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

const ITEMS = [
  { href: "/admin", label: "Panel", icon: LayoutDashboard },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/admin/customers", label: "Clientes", icon: Users },
  { href: "/admin/pagos", label: "Pagos", icon: CreditCard },
  { href: "/admin/facturacion", label: "Facturación", icon: ReceiptText },
  { href: "/admin/servicios", label: "Servicios", icon: Wrench },
  { href: "/admin/waitlist", label: "Lista de espera", icon: Sparkles },
  { href: "/admin/campanas", label: "Campañas", icon: Megaphone },
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
    <div className="admin-nav mb-5 lg:mb-0">
      <aside className="admin-sidebar lg:fixed lg:inset-y-4 lg:left-4 lg:z-40 lg:flex lg:w-64 lg:flex-col">
        <div className="admin-sidebar-panel rounded-2xl border p-3 shadow-2xl lg:flex lg:min-h-[calc(100vh-2rem)] lg:flex-col">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl border text-sm font-black text-white shadow-lg">
              {tenant?.logo_url ? (
                <img src={tenant.logo_url} alt={businessName} className="h-full w-full object-cover" />
              ) : (
                initials(businessName)
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                CITAYA
              </div>
              <div className="truncate text-sm font-black text-slate-950 sm:text-base">
                {businessName}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
              <span>Agenda activa</span>
              <StatusBadge status="active" />
              <StatusBadge tone="dark">Pro</StatusBadge>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <Link
              href="/admin/agenda"
              className="admin-primary-action inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-black text-white shadow-lg transition"
            >
              <CalendarPlus className="h-4 w-4" />
              Nueva cita
            </Link>
            <Link
              href="/admin/campanas"
              className="admin-secondary-action inline-flex items-center justify-center rounded-xl border px-3 py-2.5 text-sm font-black shadow-sm transition"
            >
              Crear campaña
            </Link>
          </div>

          <nav className="mt-4 min-w-0 lg:flex-1">
            <div className="flex min-w-max gap-1 overflow-x-auto pb-1 lg:grid lg:min-w-0 lg:gap-1.5 lg:overflow-visible lg:pb-0">
              {ITEMS.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`admin-nav-item inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition ${
                      active ? "admin-nav-item-active" : ""
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="mt-4 flex flex-wrap gap-2 lg:grid">
            <AdminLogoutButton />
            <AdminThemeToggle />
          </div>
        </div>
      </aside>
    </div>
  );
}
