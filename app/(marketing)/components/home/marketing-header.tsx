import Image from "next/image";
import Link from "next/link";

const navItems = [
  { href: "/", label: "Inicio" },
  { href: "/servicios", label: "Servicios" },
  { href: "/demos", label: "Demos" },
  { href: "/planes", label: "Planes" },
  { href: "/faq", label: "FAQ" },
] as const;

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-cyan-300/15 bg-slate-950/75 shadow-[0_14px_42px_-30px_rgba(34,211,238,0.55)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
        <Link
          href="/"
          className="group inline-flex items-center gap-3 rounded-xl border border-cyan-300/25 bg-slate-900/80 px-2.5 py-1.5 shadow-[0_0_0_1px_rgba(34,211,238,0.14)] transition-all duration-300 hover:border-cyan-200/45 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <span className="rounded-lg bg-white px-2 py-1 shadow-[0_8px_24px_-16px_rgba(148,163,184,0.7)]">
            <Image src="/citaya-logo.svg" alt="Logo Citaya" width={132} height={38} priority className="h-7 w-auto" />
          </span>
          <span className="hidden text-sm font-semibold tracking-wide text-cyan-100 md:block">
            CITAYA
            <span className="ml-1 text-xs font-medium tracking-[0.2em] text-slate-400">AUTOMATION</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs font-medium text-slate-300 sm:gap-x-4 sm:text-sm">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="link-underline rounded-sm transition-colors duration-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:text-cyan-200">
              {item.label}
            </Link>
          ))}
          <Link href="/contacto" className="ml-1 inline-flex min-h-9 items-center rounded-lg bg-gradient-to-r from-cyan-300 to-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-[0_16px_34px_-18px_rgba(34,211,238,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:text-sm">
            Solicitar demo
          </Link>
        </nav>
      </div>
    </header>
  );
}
