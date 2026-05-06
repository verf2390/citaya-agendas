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
    <header className="sticky top-0 z-50 border-b border-cyan-300/20 bg-slate-950/80 shadow-[0_20px_50px_-35px_rgba(34,211,238,0.8)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
        <Link
          href="/"
          className="group inline-flex items-center gap-2.5 rounded-xl border border-cyan-300/30 bg-slate-900/85 px-2.5 py-1.5 shadow-[0_0_0_1px_rgba(34,211,238,0.18)] transition-all duration-300 hover:border-cyan-200/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-300 to-sky-500 text-sm font-bold tracking-wide text-slate-950">
            CY
          </span>
          <span className="text-base font-semibold tracking-[0.08em] text-cyan-50 sm:text-lg">CITAYA</span>
        </Link>

        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs font-medium text-slate-300 sm:gap-x-4 sm:text-sm">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="link-underline rounded-sm transition-colors duration-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:text-cyan-200">
              {item.label}
            </Link>
          ))}
          <Link href="/contacto" className="ml-1 inline-flex min-h-9 items-center rounded-lg bg-gradient-to-r from-cyan-300 to-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-[0_18px_40px_-20px_rgba(34,211,238,0.95)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:text-sm">
            Solicitar demo
          </Link>
        </nav>
      </div>
    </header>
  );
}
