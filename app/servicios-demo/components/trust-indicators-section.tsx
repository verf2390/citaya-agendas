const indicators = [
  {
    title: "Respuesta comercial",
    value: "< 15 min hábiles",
    description: "Primer contacto para priorizar visita o cotización.",
  },
  {
    title: "Confirmación",
    value: "100% automática",
    description: "Cada lead recibe respaldo inmediato del ingreso.",
  },
  {
    title: "Cobertura",
    value: "La Serena + Coquimbo",
    description: "Operación local con ventanas horarias flexibles.",
  },
  {
    title: "Tipo de clientes",
    value: "Hogar y negocios",
    description: "Flujo adaptado a residencial, oficinas y comercio.",
  },
] as const;

export function TrustIndicatorsSection() {
  return (
    <section className="px-4 pb-10 sm:px-6 sm:pb-14 lg:px-10">
      <div className="mx-auto grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {indicators.map((indicator) => (
          <article
            key={indicator.title}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_35px_-34px_rgba(15,23,42,0.7)] sm:p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">{indicator.title}</p>
            <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900">{indicator.value}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{indicator.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
