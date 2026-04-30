"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CreditCard,
  Megaphone,
  Settings,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";

const ITEMS = [
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/admin/customers", label: "Clientes", icon: Users },
  { href: "/admin/pagos", label: "Pagos", icon: CreditCard },
  { href: "/admin/servicios", label: "Servicios", icon: Wrench },
  { href: "/admin/waitlist", label: "Waitlist", icon: Sparkles },
  { href: "/admin/campanas", label: "Campañas", icon: Megaphone },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-5 rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-sm">
      <div className="flex min-w-max gap-1 overflow-x-auto lg:min-w-0 lg:flex-wrap">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
  );
}
