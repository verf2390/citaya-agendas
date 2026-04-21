import Link from "next/link";

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
      <div className="mx-auto max-w-6xl">
        <article className="rounded-2xl border border-slate-300 bg-white p-5 shadow-[0_24px_55px_-30px_rgba(15,23,42,0.5)] transition-all duration-500 hover:-translate-y-3.5 hover:scale-[1.015] hover:border-cyan-500 hover:shadow-[0_52px_110px_-20px_rgba(8,145,178,0.7)] sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Prueba social</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Negocios reales ya están usando esto
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
            Clientes ya están recibiendo reservas automáticas sin depender de mensajes.
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-800">Fajas Paola — La Serena</p>
          <p className="mt-1 text-sm text-slate-600">Clientes reales usando este sistema</p>
          <Link
            href="https://instagram.com/fajaspaola"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 transition-all duration-200 hover:border-slate-300 hover:bg-white hover:text-slate-700"
          >
            Ver negocio real funcionando
          </Link>
        </article>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {indicators.map((indicator) => (
            <article
              key={indicator.title}
              className="rounded-2xl border border-slate-300 bg-white p-4 shadow-[0_24px_55px_-30px_rgba(15,23,42,0.5)] transition-all duration-500 hover:-translate-y-3.5 hover:scale-[1.015] hover:border-cyan-500 hover:shadow-[0_52px_110px_-20px_rgba(8,145,178,0.7)] sm:p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">{indicator.title}</p>
              <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900">{indicator.value}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{indicator.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
