import Link from "next/link";

const demos = [
  {
    name: "Agenda online para negocios de atención por hora",
    description:
      "Ideal para negocios que necesitan ordenar reservas y evitar pérdidas por coordinación manual.",
    before: "Agenda manual, mensajes cruzados y pérdida de clientes.",
    after: "Sistema de reservas 24/7 con horarios claros y confirmaciones automáticas.",
    result: "Más reservas y menos tiempo coordinando.",
    cta: "Ver demo en vivo",
    href: "https://demo.citaya.online/",
    isExternal: true,
  },
  {
    name: "Web para negocios de servicios",
    description:
      "Ejemplo de página pensada para explicar servicios de forma clara y facilitar el contacto.",
    before: "Información poco clara y pocas consultas.",
    after: "Página ordenada con servicios visibles y contacto directo.",
    result: "Más claridad y más consultas útiles.",
    cta: "Ver demo",
    href: "/servicios-demo",
    isExternal: false,
  },
  {
    name: "Web inmobiliaria",
    description: "Demo de catálogo inmobiliario con navegación simple y estructura profesional.",
    before: "Propiedades mal organizadas y difícil navegación.",
    after: "Catálogo claro con estructura profesional.",
    result: "Mejor presentación y más contactos.",
    cta: "Ver demo",
    href: "/inmo-demo",
    isExternal: false,
  },
] as const;

export function DemosShowcaseSection() {
  return (
    <section id="demos" className="px-4 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-10 lg:px-10 lg:pb-24 lg:pt-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Mira cómo se vería en tu negocio
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-700 sm:text-lg">
            Estos son ejemplos reales de páginas y sistemas que ya funcionan para distintos rubros.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:mt-12 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-7">
          {demos.map((demo) => (
            <article
              key={demo.name}
              className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.45)] transition-all duration-300 hover:-translate-y-2 hover:border-cyan-300 hover:shadow-[0_30px_65px_-28px_rgba(8,145,178,0.5)] sm:p-6"
            >
              <h3 className="text-lg font-semibold text-slate-900">{demo.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 sm:text-base">{demo.description}</p>

              <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Antes</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{demo.before}</p>
                </div>

                <div className="h-px w-full bg-slate-200" />

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Después</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{demo.after}</p>
                </div>
              </div>

              <p className="mt-4 text-sm font-semibold text-slate-900">Resultado: {demo.result}</p>

              <Link
                href={demo.href}
                target={demo.isExternal ? "_blank" : undefined}
                rel={demo.isExternal ? "noopener noreferrer" : undefined}
                className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_35px_-20px_rgba(8,145,178,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-cyan-600 hover:shadow-[0_24px_45px_-20px_rgba(8,145,178,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 active:translate-y-0 active:bg-cyan-800"
              >
                {demo.cta}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
