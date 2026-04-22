import Link from "next/link";

import { InmoHero } from "../components/inmo-hero";

const servicios = [
  {
    titulo: "Asesoría patrimonial",
    descripcion: "Diseñamos estrategias de compra, inversión o rotación de activos según tus objetivos financieros.",
    icono: "◈",
  },
  {
    titulo: "Análisis de plusvalía",
    descripcion: "Evaluamos data de mercado, desarrollo urbano y liquidez para priorizar oportunidades con proyección.",
    icono: "◎",
  },
  {
    titulo: "Acompañamiento integral",
    descripcion: "Te acompañamos desde la búsqueda hasta la negociación y cierre con una experiencia concierge.",
    icono: "✦",
  },
];

export default function ServiciosPage() {
  return (
    <main>
      <InmoHero
        eyebrow="Servicios inmobiliarios"
        title="Acompañamiento estratégico para decisiones inmobiliarias premium"
        subtitle="Integramos visión comercial, análisis y ejecución para que tomes mejores decisiones con menor fricción."
        poster="/inmo-demo/properties/pexels-alef-morais-336305364-34277650.jpg"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/inmo-demo/contacto" className="btn-inmo-primary">Solicitar asesoría privada</Link>
          <Link href="/inmo-demo/propiedades" className="btn-inmo-secondary border-white/45 bg-white/10 text-white hover:border-white hover:bg-white/20">Explorar propiedades</Link>
        </div>
      </InmoHero>

      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          {servicios.map((item) => (
            <article key={item.titulo} className="inmo-card p-7 animate-fade-in-up">
              <p className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-indigo-100 bg-indigo-50 text-lg text-indigo-700">{item.icono}</p>
              <h2 className="mt-5 text-2xl font-semibold text-slate-900">{item.titulo}</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.descripcion}</p>
            </article>
          ))}
        </div>

        <div className="mt-12 rounded-3xl border border-slate-200 bg-white p-8 animate-fade-in-up">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Metodología</p>
          <h3 className="mt-3 text-3xl font-semibold text-slate-950">Proceso claro, comunicación constante y foco en resultados</h3>
          <p className="mt-4 max-w-3xl text-slate-600">
            Cada cliente recibe una hoja de ruta personalizada con hitos de evaluación, shortlist de activos y recomendaciones ejecutables.
          </p>
        </div>
      </section>
    </main>
  );
}
