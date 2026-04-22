"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { label: "Inicio", href: "/inmo-demo" },
  { label: "Propiedades", href: "/inmo-demo/propiedades" },
  { label: "Servicios", href: "/inmo-demo/servicios" },
  { label: "Contacto", href: "/inmo-demo/contacto" },
];

export function InmoNavbar() {
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-all duration-500 ${
        isScrolled ? "border-white/10 bg-slate-950/85 backdrop-blur-xl" : "border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/inmo-demo" className="text-xs font-medium uppercase tracking-[0.24em] text-white sm:text-sm">
          LOGO EMPRESA
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {navItems.map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-xs uppercase tracking-[0.22em] transition ${
                  active ? "text-white" : "text-white/75 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/inmo-demo/contacto"
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-indigo-300/35 bg-gradient-to-r from-indigo-500 to-violet-600 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_18px_50px_-20px_rgba(79,70,229,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110"
          >
            Hablar con asesor
          </Link>
          <button
            type="button"
            aria-label="Acciones futuras"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/35 bg-white/10 text-lg text-white transition hover:bg-white/20"
          >
            +
          </button>
        </div>
      </div>
    </header>
  );
}
