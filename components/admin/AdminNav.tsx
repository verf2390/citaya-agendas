"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin/agenda", label: "Agenda" },
  { href: "/admin/customers", label: "Clientes" },
  { href: "/admin/pagos", label: "Pagos" },
  { href: "/admin/servicios", label: "Servicios" },
  { href: "/admin/configuracion", label: "Configuración" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-4 overflow-x-auto">
      <div className="flex min-w-max gap-2">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-semibold ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
