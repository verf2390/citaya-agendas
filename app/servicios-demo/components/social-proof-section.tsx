import { RevealOnScroll } from "./reveal-on-scroll";
import { SectionHeading } from "./section-heading";

const testimonials = [
  {
    type: "Hogar",
    quote: "Reservé en menos de un minuto y quedó confirmado al instante.",
    author: "Familia Rojas · La Serena",
  },
  {
    type: "Oficina",
    quote: "Dejamos de perseguir mensajes. Ahora todo entra ordenado y el equipo actúa rápido.",
    author: "Estudio Jurídico V&P · Coquimbo",
  },
  {
    type: "Comercio",
    quote: "Pasamos de improvisar horarios a tener una agenda que realmente vende.",
    author: "Café Puerto Norte · Coquimbo",
  },
] as const;

export function SocialProofSection() {
  return (
    <section className="bg-slate-50/60 px-4 py-14 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll>
          <SectionHeading
            eyebrow="Prueba social"
            title="Negocios reales ya están vendiendo con este flujo"
            description="Cuando el proceso se siente simple para el cliente, las reservas llegan con menos fricción."
          />
        </RevealOnScroll>

        <RevealOnScroll className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:mt-8 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-5">
          <div>
            <p className="text-sm font-semibold text-amber-900">Valoración promedio de experiencia</p>
            <p className="mt-1 text-sm text-amber-800">Destacan rapidez, orden y sensación de negocio profesional.</p>
          </div>
          <p className="mt-3 text-lg font-semibold text-amber-900 sm:mt-0">★★★★★ 4.9/5</p>
        </RevealOnScroll>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {testimonials.map((item, index) => (
            <RevealOnScroll
              key={item.author}
              delayMs={index * 80}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            >
              <p className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                {item.type}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-700">“{item.quote}”</p>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{item.author}</p>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
