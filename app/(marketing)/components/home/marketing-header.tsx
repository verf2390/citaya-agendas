import Image from "next/image";
import Link from "next/link";

const navItems = [
  { href: "/", label: "Inicio" },
  { href: "/servicios", label: "Servicios" },
  { href: "/demos", label: "Demos" },
  { href: "/planes", label: "Planes" },
  { href: "/faq", label: "FAQ" },
  { href: "/contacto", label: "Contacto" },
] as const;

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-cyan-300/10 bg-slate-950/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
        <Link href="/" className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
          <Image src="/citaya-logo.svg" alt="Logo Citaya" width={160} height={45} priority className="h-8 w-auto brightness-0 invert" />
        </Link>

        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs font-medium text-slate-300 sm:gap-x-4 sm:text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="link-underline rounded-sm transition-colors duration-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:text-cyan-200"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/contacto"
            className="ml-1 inline-flex min-h-9 items-center rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition-all duration-300 hover:-translate-y-0.5 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:text-sm"
          >
            Solicitar demo
          </Link>
        </nav>
      </div>
    </header>
  );
}
