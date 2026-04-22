import Link from "next/link";

import { propiedadesInmo } from "../data";

export default function PropiedadesPage() {
  return (
    <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <section className="mx-auto w-full max-w-7xl px-4 pb-8 pt-10 sm:px-6 sm:pt-14 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_55px_-40px_rgba(15,23,42,0.65)] sm:p-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/inmo-demo"
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
            >
              ← Volver al inicio demo
            </Link>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Colección premium</p>
          </div>

          <h1 className="mt-5 max-w-4xl text-3xl font-semibold leading-tight text-slate-950 sm:text-5xl">
            Catálogo curado para inversión y residencia de alto estándar
          </h1>
          <p className="mt-4 max-w-3xl text-slate-600 sm:text-lg">
            Seleccionamos activos con criterio patrimonial: ubicación, proyección y calidad real de producto.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.9)] backdrop-blur-sm sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Concierge inmobiliario</p>
              <p className="mt-1 text-sm text-slate-600">Indícanos tus preferencias y filtramos lo realmente relevante.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Ubicación
              <input
                type="text"
                placeholder="Ej: Las Condes"
                className="h-12 rounded-xl border border-slate-300 bg-white px-3 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Tipo de propiedad
              <select className="h-12 rounded-xl border border-slate-300 bg-white px-3 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200">
                <option>Departamento</option>
                <option>Casa</option>
                <option>Penthouse</option>
                <option>Loft / Dúplex</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Rango de precio
              <select className="h-12 rounded-xl border border-slate-300 bg-white px-3 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200">
                <option>UF 8.000 - 12.000</option>
                <option>UF 12.000 - 18.000</option>
                <option>UF 18.000 - 25.000</option>
                <option>UF 25.000+</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className="h-12 w-full rounded-xl border border-indigo-300/40 bg-gradient-to-r from-indigo-500 to-violet-600 px-4 text-sm font-semibold text-white shadow-[0_18px_50px_-20px_rgba(79,70,229,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110"
              >
                Buscar propiedades
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
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-34px_rgba(15,23,42,0.55)] transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_35px_70px_-32px_rgba(15,23,42,0.7)]"
            >
              <div className="relative h-60 overflow-hidden">
                <img
                  src={propiedad.imagenPrincipal}
                  alt={propiedad.titulo}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/65 via-slate-900/5 to-transparent" />
                <span className="absolute left-4 top-4 rounded-full border border-white/55 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-900">
                  {propiedad.badge}
                </span>
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

                <Link
                  href={`/inmo-demo/propiedades/${propiedad.slug}`}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50"
                >
                  Ver detalle
                </Link>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <Link
            href="/inmo-demo"
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            Volver al inicio de inmo demo
          </Link>
        </div>
      </section>
    </main>
  );
}
