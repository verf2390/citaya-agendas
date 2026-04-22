import Link from "next/link";

const cards = [
  {
    title: "Servicios",
    description: "Conoce todo lo que implementamos para ordenar y hacer crecer tu negocio.",
    href: "/servicios",
  },
  {
    title: "Demos",
    description: "Explora ejemplos reales de cómo puede verse y funcionar tu solución digital.",
    href: "/demos",
  },
  {
    title: "Planes",
    description: "Revisa opciones y precios para empezar según tu etapa y necesidades.",
    href: "/planes",
  },
] as const;

export function NavigationCardsSection() {
  return (
    <section className="bg-white px-4 pb-14 sm:px-6 sm:pb-16 lg:px-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, index) => (
            <Link
              key={card.title}
              href={card.href}
              className={`rounded-3xl border bg-white p-6 shadow-[0_28px_60px_-36px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-1.5 hover:border-cyan-400 hover:shadow-[0_42px_85px_-28px_rgba(8,145,178,0.55)] ${
                index === 0 ? "border-cyan-300" : "border-slate-200"
              }`}
            >
              <h3 className="text-xl font-bold text-slate-950">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{card.description}</p>
              <p className="mt-4 text-sm font-semibold text-cyan-700">Ver {card.title.toLowerCase()} →</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
