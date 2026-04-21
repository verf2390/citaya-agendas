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
    <section className="bg-white px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-12 lg:px-10 lg:pb-24 lg:pt-14">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Lo que implementamos para que tu negocio venda con más orden
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            No se trata solo de tener una web, sino de tener un sistema que atrae, organiza y convierte mejor.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:mt-14 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-7">
          {services.map((service) => (
            <article
              key={service.title}
              className="rounded-2xl border border-slate-300 bg-white p-5 shadow-[0_24px_55px_-30px_rgba(15,23,42,0.48)] transition-all duration-300 hover:-translate-y-3 hover:border-cyan-500 hover:shadow-[0_42px_90px_-24px_rgba(8,145,178,0.62)] sm:p-6 [&:nth-child(2n)]:bg-slate-50/70"
            >
              <h3 className="text-lg font-semibold text-slate-950">{service.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{service.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
