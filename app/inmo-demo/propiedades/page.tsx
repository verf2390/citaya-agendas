import Link from "next/link";

import { InmoHero } from "../components/inmo-hero";
import { propiedadesInmo } from "../data";

export default function PropiedadesPage() {
  return (
    <main>
      <InmoHero
        eyebrow="Portafolio premium"
        title="Catálogo inmobiliario curado"
        subtitle="Explora oportunidades residenciales y de inversión seleccionadas por plusvalía, ubicación y liquidez."
        poster="/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/inmo-demo/contacto" className="btn-inmo-primary">
            Hablar con asesor
          </Link>
          <Link href="/inmo-demo" className="btn-inmo-secondary border-white/45 bg-white/10 text-white hover:border-white hover:bg-white/20">
            Volver a inicio
          </Link>
        </div>
      </InmoHero>

      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.9)] backdrop-blur-sm sm:p-6 animate-fade-in-up">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Filtros de búsqueda</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Ubicación
              <input type="text" placeholder="Ej: Las Condes" className="h-12 rounded-xl border border-slate-300 bg-white px-3 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200" />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Tipo
              <select className="h-12 rounded-xl border border-slate-300 bg-white px-3 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200">
                <option>Departamento</option><option>Casa</option><option>Penthouse</option><option>Loft / Dúplex</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Precio
              <select className="h-12 rounded-xl border border-slate-300 bg-white px-3 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200">
                <option>UF 8.000 - 12.000</option><option>UF 12.000 - 18.000</option><option>UF 18.000 - 25.000</option><option>UF 25.000+</option>
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" className="btn-inmo-primary h-12 w-full justify-center">Buscar propiedades</button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {propiedadesInmo.map((propiedad) => (
            <article key={propiedad.slug} className="inmo-card group animate-fade-in-up">
              <div className="relative h-60 overflow-hidden">
                <img src={propiedad.imagenPrincipal} alt={propiedad.titulo} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/65 via-slate-900/5 to-transparent" />
                <span className="absolute left-4 top-4 rounded-full border border-white/55 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-900">{propiedad.badge}</span>
              </div>

              <div className="space-y-4 p-6">
                <p className="text-2xl font-semibold tracking-tight text-indigo-700">{propiedad.precio}</p>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{propiedad.titulo}</h2>
                  <p className="mt-1 text-sm text-slate-500">{propiedad.ubicacion}</p>
                </div>
                <ul className="grid grid-cols-4 gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-center text-xs text-slate-600">
                  <li><p className="font-semibold text-slate-900">{propiedad.metros}</p><p>m²</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.habitaciones}</p><p>Dorm.</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.banos}</p><p>Baños</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.estacionamientos}</p><p>Estac.</p></li>
                </ul>
                <Link href={`/inmo-demo/propiedades/${propiedad.slug}`} className="btn-inmo-secondary w-full justify-center">Ver detalle</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
