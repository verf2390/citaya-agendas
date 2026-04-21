import Link from "next/link";

const propiedades = [
  {
    slug: "penthouse-vista-panoramica",
    etiqueta: "Destacada",
    precio: "UF 18.900",
    titulo: "Penthouse con vista panorámica",
    ubicacion: "Las Condes, Santiago",
    habitaciones: 4,
    banos: 3,
    metros: 245,
    imagen: "/inmo-demo/properties/pexels-griffinw-6643264.jpg",
  },
  {
    slug: "residencia-jardin-privado",
    etiqueta: "Nueva",
    precio: "UF 24.500",
    titulo: "Residencia con jardín privado",
    ubicacion: "Lo Barnechea, Santiago",
    habitaciones: 5,
    banos: 4,
    metros: 390,
    imagen: "/inmo-demo/properties/pexels-artbovich-8141956.jpg",
  },
  {
    slug: "departamento-boutique-vitacura",
    etiqueta: "Exclusiva",
    precio: "UF 12.300",
    titulo: "Departamento boutique en Vitacura",
    ubicacion: "Vitacura, Santiago",
    habitaciones: 3,
    banos: 2,
    metros: 148,
    imagen: "/inmo-demo/properties/pexels-naimbic-2030037.jpg",
  },
  {
    slug: "casa-contemporanea-chicureo",
    etiqueta: "Destacada",
    precio: "UF 21.700",
    titulo: "Casa contemporánea en condominio",
    ubicacion: "Chicureo, Colina",
    habitaciones: 4,
    banos: 4,
    metros: 320,
    imagen: "/inmo-demo/properties/pexels-the-ghazi-2152398165-32421762.jpg",
  },
  {
    slug: "loft-autor-ultima-milla",
    etiqueta: "Nueva",
    precio: "UF 9.850",
    titulo: "Loft de autor estilo industrial",
    ubicacion: "Providencia, Santiago",
    habitaciones: 2,
    banos: 2,
    metros: 112,
    imagen: "/inmo-demo/properties/pexels-ansar-muhammad-380085065-27604130.jpg",
  },
  {
    slug: "duplex-terraza-mirador",
    etiqueta: "Premium",
    precio: "UF 15.200",
    titulo: "Dúplex con terraza mirador",
    ubicacion: "Ñuñoa, Santiago",
    habitaciones: 3,
    banos: 3,
    metros: 176,
    imagen: "/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg",
  },
];

export default function PropiedadesPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="mx-auto w-full max-w-7xl px-4 pb-8 pt-12 sm:px-6 sm:pb-10 sm:pt-16 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-cyan-200/80 bg-gradient-to-br from-slate-950/10 via-cyan-200/70 to-white p-5 shadow-[0_40px_110px_-45px_rgba(15,23,42,0.62)] sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Colección inmobiliaria</p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">Propiedades disponibles</h1>
          <p className="mt-5 max-w-3xl text-base text-slate-600 sm:text-lg">
            Selección premium de activos residenciales con alto estándar de diseño, ubicación estratégica y potencial
            sólido de valorización para vivienda e inversión.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-300 bg-white p-4 sm:p-6 shadow-[0_24px_55px_-30px_rgba(15,23,42,0.5)]">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Ubicación
              <input
                type="text"
                placeholder="Ej: Las Condes"
                className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition-all duration-200 focus:border-cyan-500 focus:bg-white"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Tipo de propiedad
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition-all duration-200 focus:border-cyan-500 focus:bg-white">
                <option>Departamento</option>
                <option>Casa</option>
                <option>Penthouse</option>
                <option>Loft</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Rango de precio
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition-all duration-200 focus:border-cyan-500 focus:bg-white">
                <option>UF 8.000 - 12.000</option>
                <option>UF 12.000 - 18.000</option>
                <option>UF 18.000 - 25.000</option>
                <option>UF 25.000+</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                className="h-11 w-full rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_30px_66px_-10px_rgba(8,145,178,1)] transition-all duration-300 hover:-translate-y-2 hover:scale-[1.015] hover:from-cyan-600 hover:to-cyan-500 hover:shadow-[0_46px_92px_-12px_rgba(8,145,178,1)]"
              >
                Buscar
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 sm:gap-6">
          {propiedades.map((propiedad) => (
            <article
              key={propiedad.slug}
              className="group overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_24px_55px_-30px_rgba(15,23,42,0.5)] transition-all duration-500 hover:-translate-y-3.5 hover:scale-[1.015] hover:border-cyan-500 hover:shadow-[0_52px_110px_-20px_rgba(8,145,178,0.7)]"
            >
              <div className="relative h-56 overflow-hidden rounded-t-2xl">
                <img
                  src={propiedad.imagen}
                  alt={propiedad.titulo}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/45 via-slate-900/10 to-slate-900/35" />
                <span className="absolute left-4 top-4 rounded-full border border-cyan-200 bg-white/95 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-800">
                  {propiedad.etiqueta}
                </span>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <p className="text-2xl font-semibold text-cyan-700">{propiedad.precio}</p>
                <div>
                  <h2 className="text-base font-semibold leading-tight text-slate-900 sm:text-lg">{propiedad.titulo}</h2>
                  <p className="mt-1 text-sm text-slate-500">{propiedad.ubicacion}</p>
                </div>

                <ul className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-600 sm:text-sm">
                  <li>
                    <p className="font-medium text-slate-900">{propiedad.habitaciones}</p>
                    <p>Habitaciones</p>
                  </li>
                  <li>
                    <p className="font-medium text-slate-900">{propiedad.banos}</p>
                    <p>Baños</p>
                  </li>
                  <li>
                    <p className="font-medium text-slate-900">{propiedad.metros}</p>
                    <p>m²</p>
                  </li>
                </ul>

                <Link
                  href={`/inmo-demo/propiedades/${propiedad.slug}`}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-800 transition-all duration-200 hover:border-slate-300 hover:bg-white sm:w-auto sm:justify-start"
                >
                  Ver detalle
                  <span aria-hidden="true" className="ml-1 transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 sm:pb-16 lg:px-8">
        <div className="rounded-3xl border border-slate-300 bg-slate-50 p-6 sm:p-10">
          <h3 className="text-xl font-semibold text-slate-900 sm:text-3xl">Asesoría personalizada para tu próxima inversión</h3>
          <p className="mt-3 max-w-3xl text-slate-600">
            Nuestro equipo te acompaña con análisis de oportunidades, evaluación financiera y negociación estratégica
            para encontrar la propiedad ideal según tu perfil.
          </p>
          <p className="mt-3 max-w-3xl text-sm text-slate-600/90">
            Elige una propiedad y agenda una llamada guiada para resolver plusvalía, financiamiento y plazos en una
            sola conversación.
          </p>
          <div className="mt-6">
            <Link
              href="/inmo-demo/contacto"
              className="inline-flex min-h-11 rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_30px_66px_-10px_rgba(8,145,178,1)] transition-all duration-300 hover:-translate-y-2 hover:scale-[1.015] hover:from-cyan-600 hover:to-cyan-500 hover:shadow-[0_46px_92px_-12px_rgba(8,145,178,1)]"
            >
              Hablar con un asesor
            </Link>
          </div>

          <div className="mt-8 grid gap-2 text-sm text-slate-600 sm:grid-cols-3 sm:gap-4">
            <p>
              <span className="font-medium text-slate-700">WhatsApp:</span> +56 9 6142 5029
            </p>
            <p>
              <span className="font-medium text-slate-700">Instagram:</span> @citaya_agenda
            </p>
            <p>
              <span className="font-medium text-slate-700">Email:</span> verf14@gmail.com
            </p>
          </div>
        </div>
      </section>

      <a
        href="https://wa.me/56961425029"
        target="_blank"
        rel="noreferrer"
        aria-label="Contactar por WhatsApp"
        className="fixed bottom-4 right-4 z-50 inline-flex min-h-11 items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-500/95 px-3.5 py-2.5 text-sm font-semibold text-emerald-950 shadow-[0_16px_35px_-18px_rgba(16,185,129,0.8)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-400 sm:bottom-5 sm:right-5 sm:px-4 sm:py-3"
      >
        <span aria-hidden="true">✦</span>
        WhatsApp
      </a>
    </main>
  );
}
