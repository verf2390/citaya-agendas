import Link from "next/link";
import { InmoHero } from "../components/inmo-hero";

const servicios = [
  ["Asesoría patrimonial", "Definimos una ruta de compra, venta o inversión según objetivo, liquidez y perfil de riesgo."],
  ["Curaduría de propiedades", "Filtramos activos por ubicación, plusvalía, estado, demanda y valor de entrada."],
  ["Estrategia de venta", "Posicionamos cada propiedad con pricing, relato y canal comercial según mercado objetivo."],
  ["Presentación digital", "Creamos una vitrina visual de alto estándar para elevar confianza y calidad de lead."],
  ["Acompañamiento hasta el cierre", "Gestionamos coordinación, negociación y soporte documental con comunicación constante."],
];

export default function ServiciosPage() {
  return (
    <main className="bg-[#f4f4f2]">
      <InmoHero eyebrow="Servicios inmobiliarios" title="Asesoría boutique para decisiones con impacto patrimonial" subtitle="Integramos análisis, curaduría y ejecución comercial para que cada propiedad se presente con autoridad." poster="/inmo-demo/properties/pexels-alef-morais-336305364-34277650.jpg" heightClassName="min-h-[72vh]">
        <div className="flex flex-col gap-3 sm:flex-row"><Link href="/inmo-demo/contacto" className="btn-inmo-primary border-white/20 bg-white text-neutral-950 hover:bg-zinc-200">Solicitar asesoría privada</Link><Link href="/inmo-demo/propiedades" className="btn-inmo-secondary border-white/45 bg-white/10 text-white">Explorar propiedades</Link></div>
      </InmoHero>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{servicios.map(([t,d]) => <article key={t} className="rounded-2xl border border-neutral-200 bg-white p-7"><h2 className="text-xl font-medium text-neutral-900">{t}</h2><p className="mt-3 text-sm leading-relaxed text-neutral-600">{d}</p></article>)}</div></section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8"><div className="rounded-2xl border border-neutral-200 bg-neutral-950 p-8 text-white"><p className="text-xs uppercase tracking-[0.22em] text-zinc-300">Proceso de trabajo</p><ol className="mt-5 grid gap-4 sm:grid-cols-2"><li>1. Definimos tu perfil</li><li>2. Seleccionamos oportunidades</li><li>3. Coordinamos visita o contacto</li><li>4. Avanzas con asesoría clara</li></ol></div></section>
    </main>
  );
}
