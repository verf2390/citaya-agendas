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
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
        <Link href="/" className="shrink-0">
          <Image src="/citaya-logo.svg" alt="Logo Citaya" width={160} height={45} priority className="h-8 w-auto" />
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs font-semibold text-slate-600 sm:gap-x-4 sm:text-sm">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-cyan-700">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
