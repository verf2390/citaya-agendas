import Link from "next/link";

import { InmoHero } from "./components/inmo-hero";
import { propiedadesInmo } from "./data";

const servicios = [
  ["Asesoría patrimonial", "Definimos una ruta de compra, venta o inversión según objetivo, liquidez y perfil de riesgo."],
  ["Curaduría de activos", "Filtramos oportunidades por ubicación, plusvalía, estado, demanda y valor de entrada."],
  ["Presentación premium", "Cada propiedad se muestra con una narrativa visual clara para atraer interesados mejor calificados."],
  ["Acompañamiento integral", "Desde la primera consulta hasta la negociación y cierre, con contacto directo y criterios claros."],
];

export default function InmoDemoHomePage() {
  return (
    <main className="overflow-x-hidden bg-[#f4f4f2]">
      <InmoHero eyebrow="Advisory boutique · Santiago Oriente" title="Propiedades premium y asesoría inmobiliaria con criterio" subtitle="Una experiencia digital pensada para mostrar propiedades, captar interesados calificados y guiar cada contacto hacia una conversación seria." editorialNote="Catálogo curado · Atención personalizada · Contacto directo">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/inmo-demo/propiedades" className="btn-inmo-primary border-white/20 bg-white px-7 text-neutral-950 hover:bg-zinc-200">Ver propiedades</Link>
          <Link href="/inmo-demo/contacto" className="btn-inmo-secondary border-white/45 bg-white/10 text-white hover:border-white hover:bg-white/20">Hablar con asesor</Link>
        </div>
      </InmoHero>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-semibold text-neutral-950 sm:text-4xl">Propiedades destacadas</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">{propiedadesInmo.slice(0, 3).map((p) => <article key={p.slug} className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_28px_70px_-45px_rgba(0,0,0,.55)]"><div className="relative h-72 overflow-hidden"><img src={p.imagenPrincipal} alt={p.titulo} className="h-full w-full object-cover transition duration-700 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" /><span className="absolute left-4 top-4 rounded-full border border-white/60 bg-black/55 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white">{p.badge}</span><p className="absolute bottom-4 left-4 text-sm text-white/90">{p.ubicacion}</p></div><div className="space-y-4 p-6"><p className="text-2xl font-semibold text-neutral-900">{p.precio}</p><h3 className="text-lg font-medium text-neutral-900">{p.titulo}</h3><ul className="grid grid-cols-4 gap-2 border-y border-neutral-200 py-3 text-center text-xs text-neutral-600"><li>{p.metros} m²</li><li>{p.habitaciones} dorm</li><li>{p.banos} baños</li><li>{p.estacionamientos} est.</li></ul><Link href={`/inmo-demo/propiedades/${p.slug}`} className="btn-inmo-secondary w-full justify-center border-neutral-300 text-neutral-800 hover:bg-neutral-100">Ver detalle</Link></div></article>)}</div>
      </section>

      <section className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-2 lg:grid-cols-4">{servicios.map(([titulo, descripcion]) => <article key={titulo} className="rounded-2xl border border-white/15 bg-white/[0.03] p-6"><h3 className="text-lg font-medium">{titulo}</h3><p className="mt-3 text-sm leading-relaxed text-zinc-300">{descripcion}</p></article>)}</div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6 sm:grid-cols-5">
          {[["24h", "respuesta comercial"], ["3", "zonas prioritarias"], ["100%", "asesoría personalizada"], ["Catálogo", "curado"], ["WhatsApp", "contacto directo"]].map(([n, t]) => <div key={n}><p className="text-2xl font-semibold text-neutral-900">{n}</p><p className="text-xs uppercase tracking-[.18em] text-neutral-500">{t}</p></div>)}
        </div>
      </section>
    </main>
  );
}
