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
  const [openMobile, setOpenMobile] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);


  return (
    <header className={`fixed inset-x-0 top-0 z-50 border-b transition-all duration-500 ${isScrolled ? "border-white/10 bg-neutral-950/90 backdrop-blur-xl" : "border-white/10 bg-neutral-950/45 backdrop-blur-md"}`}>
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/inmo-demo" className="text-xs font-medium uppercase tracking-[0.34em] text-white sm:text-sm">CITAYA ESTATES</Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`text-xs uppercase tracking-[0.24em] transition ${active ? "text-white" : "text-zinc-300 hover:text-white"}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/inmo-demo/contacto" className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/30 bg-white px-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-950 transition hover:bg-zinc-200">
            Hablar con asesor
          </Link>
          <button type="button" aria-label="Acciones futuras" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/35 bg-white/10 text-lg text-white transition hover:bg-white/20">+</button>
        </div>

        <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/30 text-white md:hidden" onClick={() => setOpenMobile((prev) => !prev)} aria-label="Abrir menú">☰</button>
      </div>

      {openMobile ? (
        <div className="border-t border-white/10 bg-neutral-950/95 px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-3">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return <Link key={item.href} href={item.href} className={`text-xs uppercase tracking-[0.22em] ${active ? "text-white" : "text-zinc-300"}`}>{item.label}</Link>;
            })}
            <Link href="/inmo-demo/contacto" className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full border border-white/25 bg-white px-4 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-950">Hablar con asesor</Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
