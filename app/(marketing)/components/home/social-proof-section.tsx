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
    <section className="px-4 pb-16 pt-8 sm:px-6 sm:pb-18 sm:pt-10 lg:px-10 lg:pb-24 lg:pt-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-3xl lg:text-4xl">
            Resultados que se notan en el día a día
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-500 sm:text-lg">
            Cuando el proceso de contacto y agenda se ordena, se nota rápido: menos caos, más control y mejores
            conversiones.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6">
          {testimonials.map((testimonial) => (
            <article
              key={testimonial}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.55)] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-200 hover:shadow-[0_26px_48px_-30px_rgba(8,145,178,0.42)] sm:p-6"
            >
              <p className="text-sm leading-relaxed text-slate-700 sm:text-base">“{testimonial}”</p>
            </article>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-3 sm:gap-4">
          {indicators.map((indicator) => (
            <div
              key={indicator}
              className="flex items-center gap-3 rounded-xl border border-cyan-200 bg-cyan-50/80 px-4 py-3 shadow-[0_12px_28px_-24px_rgba(8,145,178,0.45)]"
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
