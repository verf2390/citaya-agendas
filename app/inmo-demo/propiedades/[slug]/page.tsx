import Link from "next/link";

import { propiedadesInmo } from "../../data";

type PropiedadDetallePageProps = {
  params: {
    slug: string;
  };
};

export default function PropiedadDetallePage({ params }: PropiedadDetallePageProps) {
  const propiedad = propiedadesInmo.find((item) => item.slug === params.slug);

  if (!propiedad) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-4 py-14 sm:px-6 sm:py-16">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">inmo demo</p>
          <h1 className="mt-4 text-2xl font-semibold sm:text-3xl md:text-4xl">Propiedad no encontrada</h1>
          <p className="mt-4 max-w-2xl text-slate-600">
            No encontramos una propiedad asociada al slug <span className="font-mono">{params.slug}</span>.
            Puedes volver al catálogo para seguir explorando oportunidades exclusivas.
          </p>
          <Link
            href="/inmo-demo/propiedades"
            className="mt-8 inline-flex min-h-12 rounded-xl border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            ← Volver al catálogo
          </Link>
        </section>
      </main>
    );
  }

  const relacionadas = propiedadesInmo.filter((item) => item.slug !== propiedad.slug).slice(0, 3);

  return (
    <main className="bg-[#f8fafc] text-slate-900">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
        <Link
          href="/inmo-demo/propiedades"
          className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 px-4 py-2 text-xs uppercase tracking-[0.18em] text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
        >
          ← Volver a propiedades
        </Link>

        <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="relative">
            <img src={propiedad.imagenPrincipal} alt={propiedad.titulo} className="h-72 w-full object-cover sm:h-[420px]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/5" />
            <div className="absolute bottom-0 p-6 text-white sm:p-8">
              <span className="rounded-full border border-white/40 bg-white/15 px-3 py-1 text-xs uppercase tracking-wide">{propiedad.badge}</span>
              <h1 className="mt-3 text-3xl font-semibold sm:text-5xl">{propiedad.titulo}</h1>
              <p className="mt-2 text-sm text-slate-200 sm:text-base">{propiedad.ubicacion}</p>
              <p className="mt-4 text-2xl font-semibold text-amber-100 sm:text-4xl">{propiedad.precio}</p>
            </div>
          </div>

          <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Feature label="Superficie" value={`${propiedad.metros} m²`} />
                <Feature label="Dormitorios" value={`${propiedad.habitaciones}`} />
                <Feature label="Baños" value={`${propiedad.banos}`} />
                <Feature label="Estacionamientos" value={`${propiedad.estacionamientos}`} />
              </div>

              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h2 className="text-xl font-semibold">Descripción</h2>
                <p className="mt-3 text-slate-700">{propiedad.descripcion}</p>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-xl font-semibold">Ideal para</h2>
                <p className="mt-3 text-slate-700">
                  {propiedad.idealPara === "Familia"
                    ? "Familias que priorizan amplitud, barrio consolidado y calidad de vida."
                    : propiedad.idealPara === "Inversión"
                      ? "Inversionistas que buscan una propiedad líquida y con plusvalía proyectada."
                      : "Perfil mixto: combina vida familiar premium con proyección patrimonial."}
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">Galería</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {propiedad.galeria.slice(0, 3).map((imagen, index) => (
                    <div key={imagen} className="overflow-hidden rounded-xl border border-slate-200">
                      <img
                        src={imagen}
                        alt={`${propiedad.titulo} galería ${index + 1}`}
                        className="h-40 w-full object-cover transition duration-300 hover:scale-105"
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <aside className="h-fit rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Concierge inmobiliario</p>
              <h3 className="mt-2 text-2xl font-semibold">Agenda tu próxima visita</h3>
              <p className="mt-3 text-sm text-slate-300">
                Te orientamos con criterio comercial para que tomes una decisión segura y rentable.
              </p>

              <div className="mt-6 space-y-3">
                <a
                  href="/inmo-demo/contacto"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 text-sm font-semibold text-white shadow-[0_16px_45px_-14px_rgba(109,40,217,0.9)] transition-all duration-300 hover:scale-[1.02] hover:brightness-110"
                >
                  Agendar visita
                </a>
                <a
                  href="https://wa.me/56961425029"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
                >
                  <span aria-hidden="true">✦</span>
                  Hablar por WhatsApp
                </a>
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 sm:p-8">
          <h2 className="text-xl font-semibold sm:text-2xl">Propiedades relacionadas</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {relacionadas.map((item) => (
              <Link
                key={item.slug}
                href={`/inmo-demo/propiedades/${item.slug}`}
                className="group block rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:-translate-y-1 hover:bg-white"
              >
                <p className="text-xs uppercase tracking-[0.15em] text-slate-500">{item.tipo}</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">{item.titulo}</h3>
                <p className="mt-1 text-sm text-slate-500">{item.ubicacion}</p>
                <p className="mt-4 text-base font-semibold text-indigo-700">{item.precio}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </article>
  );
}
