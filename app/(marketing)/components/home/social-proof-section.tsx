const testimonials = [
  "Ahora las reservas entran mucho más ordenadas y no se nos pasan consultas.",
  "Dejamos de depender de responder todo al instante por WhatsApp.",
  "La web por fin explica bien lo que hacemos y la gente llega más decidida.",
] as const;

const indicators = [
  "Menos tiempo coordinando manualmente",
  "Más consultas con intención real",
  "Mejor organización diaria",
] as const;

export function SocialProofSection() {
  return (
    <section className="px-4 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-10 lg:px-10 lg:pb-24 lg:pt-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Resultados que se notan en el día a día
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-700 sm:text-lg">
            Cuando el proceso de contacto y agenda se ordena, se nota rápido: menos caos, más control y mejores
            conversiones.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:mt-12 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-7">
          {testimonials.map((testimonial) => (
            <article
              key={testimonial}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.45)] transition-all duration-300 hover:-translate-y-2 hover:border-cyan-300 hover:shadow-[0_30px_65px_-28px_rgba(8,145,178,0.5)] sm:p-6"
            >
              <p className="text-sm leading-relaxed text-slate-700 sm:text-base">“{testimonial}”</p>
            </article>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-3 sm:gap-4">
          {indicators.map((indicator) => (
            <div
              key={indicator}
              className="flex items-center gap-3 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3"
            >
              <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-600" aria-hidden />
              <p className="text-sm font-medium leading-relaxed text-slate-700">{indicator}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
