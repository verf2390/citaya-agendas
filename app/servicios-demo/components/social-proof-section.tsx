import { SectionHeading } from "./section-heading";

const testimonials = [
  {
    type: "Hogar",
    quote: "Nos respondieron el mismo día, agendamos visita y quedó todo instalado sin vueltas.",
    author: "Familia Rojas · La Serena",
  },
  {
    type: "Oficina",
    quote: "La coordinación fue súper ordenada. El equipo llegó puntual y la mantención quedó documentada.",
    author: "Estudio Jurídico V&P · Coquimbo",
  },
  {
    type: "Local comercial",
    quote: "Necesitábamos rapidez para no frenar ventas. Tuvimos diagnóstico, propuesta y ejecución en plazo.",
    author: "Café Puerto Norte · Coquimbo",
  },
] as const;

export function SocialProofSection() {
  return (
    <section className="bg-slate-50/70 px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Prueba social"
          title="Experiencias reales que refuerzan confianza comercial"
          description="Señales creíbles para que nuevos clientes avancen con seguridad desde el primer contacto."
        />

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-5">
          <div>
            <p className="text-sm font-semibold text-amber-900">Valoración promedio de atención</p>
            <p className="mt-1 text-sm text-amber-800">Reseñas destacadas por rapidez, orden y trato profesional.</p>
          </div>
          <p className="mt-3 text-lg font-semibold text-amber-900 sm:mt-0">★★★★★ 4.9/5</p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {testimonials.map((item) => (
            <article
              key={item.author}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_45px_-40px_rgba(15,23,42,0.75)]"
            >
              <p className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                {item.type}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-700">“{item.quote}”</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{item.author}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
