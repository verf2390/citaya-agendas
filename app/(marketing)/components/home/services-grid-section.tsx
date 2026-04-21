const services = [
  {
    title: "Diseño de páginas web",
    description:
      "Creamos páginas claras y modernas para que tus clientes entiendan lo que haces y te contacten sin fricción.",
  },
  {
    title: "Agenda online",
    description:
      "Tus clientes pueden reservar en cualquier momento sin depender de que respondas mensajes.",
  },
  {
    title: "Automatizaciones",
    description:
      "Confirmaciones, recordatorios y seguimiento automático para reducir trabajo manual.",
  },
  {
    title: "Optimización web",
    description:
      "Mejoramos tu web para que cargue rápido, se entienda mejor y genere más consultas.",
  },
  {
    title: "Soluciones digitales",
    description:
      "Combinamos herramientas según tu negocio para ayudarte a vender con más orden.",
  },
] as const;

export function ServicesGridSection() {
  return (
    <section className="px-4 pb-14 pt-4 sm:px-6 sm:pb-16 sm:pt-6 lg:px-10 lg:pb-20 lg:pt-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
            Lo que implementamos para que tu negocio venda con más orden
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            No se trata solo de tener una web, sino de tener un sistema que atrae, organiza y convierte mejor.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6">
          {services.map((service) => (
            <article
              key={service.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-md sm:p-6"
            >
              <h3 className="text-lg font-semibold text-slate-900">{service.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{service.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
