import Link from "next/link";

import { propiedadesInmo } from "../data";

export default function PropiedadesPage() {
  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-900">
      <section className="mx-auto w-full max-w-7xl px-4 pb-8 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Colección premium</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-5xl">Invierte en ubicaciones con proyección real</h1>
          <p className="mt-4 max-w-3xl text-slate-600 sm:text-lg">
            Seleccionamos propiedades con criterio para perfiles que buscan patrimonio, seguridad y valorización.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Ubicación
              <input type="text" placeholder="Ej: Las Condes" className="h-12 rounded-xl border border-slate-300 px-3" />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Tipo de propiedad
              <select className="h-12 rounded-xl border border-slate-300 px-3">
                <option>Departamento</option>
                <option>Casa</option>
                <option>Penthouse</option>
                <option>Loft / Dúplex</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Rango de precio
              <select className="h-12 rounded-xl border border-slate-300 px-3">
                <option>UF 8.000 - 12.000</option>
                <option>UF 12.000 - 18.000</option>
                <option>UF 18.000 - 25.000</option>
                <option>UF 25.000+</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className="h-12 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 text-sm font-semibold text-white shadow-[0_16px_45px_-14px_rgba(109,40,217,0.9)] transition-all duration-300 hover:scale-[1.02] hover:brightness-110"
              >
                Buscar
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {propiedadesInmo.map((propiedad) => (
            <article
              key={propiedad.slug}
              className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_20px_50px_-30px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_30px_60px_-24px_rgba(15,23,42,0.55)]"
            >
              <div className="relative h-56 overflow-hidden">
                <img
                  src={propiedad.imagenPrincipal}
                  alt={propiedad.titulo}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className="absolute left-4 top-4 rounded-full border border-white/60 bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-900">
                  {propiedad.badge}
                </span>
              </div>

              <div className="space-y-4 p-5">
                <p className="text-2xl font-semibold text-indigo-700">{propiedad.precio}</p>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{propiedad.titulo}</h2>
                  <p className="mt-1 text-sm text-slate-500">{propiedad.ubicacion}</p>
                </div>

                <ul className="grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs text-slate-600">
                  <li><p className="font-semibold text-slate-900">{propiedad.metros}</p><p>m²</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.habitaciones}</p><p>Dorm.</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.banos}</p><p>Baños</p></li>
                  <li><p className="font-semibold text-slate-900">{propiedad.estacionamientos}</p><p>Estac.</p></li>
                </ul>

                <Link
                  href={`/inmo-demo/propiedades/${propiedad.slug}`}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Ver detalle
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
