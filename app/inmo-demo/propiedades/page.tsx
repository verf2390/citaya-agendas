import Link from "next/link";
import { InmoHero } from "../components/inmo-hero";
import { propiedadesInmo } from "../data";

export default function PropiedadesPage() {
  return (
    <main className="bg-[#f4f4f2]">
      <InmoHero eyebrow="Portafolio premium" title="Residencias seleccionadas para decisiones inmobiliarias de alto valor" subtitle="Catálogo con filtros y presentación editorial para facilitar decisiones de compra e inversión." poster="/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg" heightClassName="min-h-[74vh]">
        <div className="flex flex-col gap-3 sm:flex-row"><Link href="/inmo-demo/contacto" className="btn-inmo-primary border-white/20 bg-white text-neutral-950 hover:bg-zinc-200">Hablar con asesor</Link><Link href="/inmo-demo" className="btn-inmo-secondary border-white/45 bg-white/10 text-white">Volver a inicio</Link></div>
      </InmoHero>
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8"><div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{propiedadesInmo.map((p)=><article key={p.slug} className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_28px_70px_-45px_rgba(0,0,0,.55)]"><div className="relative h-64 overflow-hidden"><img src={p.imagenPrincipal} alt={p.titulo} className="h-full w-full object-cover transition duration-700 group-hover:scale-105"/><div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"/><span className="absolute left-4 top-4 rounded-full border border-white/60 bg-black/60 px-3 py-1 text-[10px] uppercase tracking-[.2em] text-white">{p.badge}</span></div><div className="space-y-4 p-6"><p className="text-2xl font-semibold text-neutral-900">{p.precio}</p><h2 className="text-lg font-medium text-neutral-900">{p.titulo}</h2><p className="text-sm text-neutral-500">{p.ubicacion}</p><ul className="grid grid-cols-4 gap-2 border-y border-neutral-200 py-3 text-center text-xs text-neutral-600"><li>{p.metros} m²</li><li>{p.habitaciones} dorm</li><li>{p.banos} baños</li><li>{p.estacionamientos} est.</li></ul><Link href={`/inmo-demo/propiedades/${p.slug}`} className="btn-inmo-secondary w-full justify-center border-neutral-300 text-neutral-800 hover:bg-neutral-100">Ver detalle</Link></div></article>)}</div></section>
    </main>
  );
}
