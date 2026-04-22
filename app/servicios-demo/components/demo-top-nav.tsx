"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/servicios-demo", label: "Inicio" },
  { href: "/servicios-demo/demo", label: "Demo" },
  { href: "/servicios-demo/contacto", label: "Contacto" },
  { href: "/servicios-demo/faq", label: "FAQ" },
] as const;

export function DemoTopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
        <Link href="/servicios-demo" className="text-sm font-semibold tracking-tight text-slate-900 sm:text-base">
          Citaya Demo
        </Link>

        <nav className="flex flex-wrap items-center justify-end gap-2">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`inline-flex min-h-10 items-center justify-center rounded-xl px-3.5 text-xs font-semibold transition-all duration-300 sm:text-sm ${
                  isActive
                    ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-[0_12px_30px_-16px_rgba(79,70,229,0.9)]"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
