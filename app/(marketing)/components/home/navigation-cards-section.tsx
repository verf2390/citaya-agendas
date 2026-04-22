import Link from "next/link";
import { RevealOnScroll } from "./reveal-on-scroll";

const cards = [
  {
    title: "Servicios",
    description: "Conoce todo lo que implementamos para ordenar y hacer crecer tu negocio.",
    href: "/servicios",
    icon: "⚙️",
  },
  {
    title: "Demos",
    description: "Explora ejemplos reales de cómo puede verse y funcionar tu solución digital.",
    href: "/demos",
    icon: "✨",
  },
  {
    title: "Planes",
    description: "Revisa opciones y precios para empezar según tu etapa y necesidades.",
    href: "/planes",
    icon: "📈",
  },
] as const;

export function NavigationCardsSection() {
  return (
    <section className="bg-white px-4 pb-14 sm:px-6 sm:pb-16 lg:px-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, index) => (
            <RevealOnScroll key={card.title} delayMs={index * 90}>
              <Link
                href={card.href}
                className={`group rounded-3xl border bg-white/95 p-6 shadow-[0_28px_60px_-36px_rgba(15,23,42,0.5)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-cyan-400 hover:shadow-[0_42px_85px_-28px_rgba(8,145,178,0.55)] active:scale-[0.995] ${
                  index === 0 ? "border-cyan-300" : "border-slate-200"
                }`}
              >
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-base shadow-inner shadow-cyan-200/60">
                  <span aria-hidden>{card.icon}</span>
                </div>
                <h3 className="mt-4 text-xl font-bold text-slate-950">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{card.description}</p>
                <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-700">
                  <span>Ver {card.title.toLowerCase()}</span>
                  <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </p>
              </Link>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
