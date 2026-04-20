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
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <section className="mx-auto w-full max-w-7xl px-4 pb-8 pt-12 sm:px-6 sm:pb-10 sm:pt-16 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-stone-300/15 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-5 shadow-2xl shadow-black/30 sm:p-12">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-stone-300">Colección inmobiliaria</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-5xl">Propiedades disponibles</h1>
          <p className="mt-5 max-w-3xl text-base text-zinc-300 sm:text-lg">
            Selección premium de activos residenciales con alto estándar de diseño, ubicación estratégica y potencial
            sólido de valorización para vivienda e inversión.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-stone-300/15 bg-zinc-900/70 p-4 backdrop-blur sm:p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Ubicación
              <input
                type="text"
                placeholder="Ej: Las Condes"
                className="h-11 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-all duration-200 focus:border-[#d4c09e]/60 focus:bg-zinc-900"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Tipo de propiedad
              <select className="h-11 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-[#d4c09e]/60 focus:bg-zinc-900">
                <option>Departamento</option>
                <option>Casa</option>
                <option>Penthouse</option>
                <option>Loft</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Rango de precio
              <select className="h-11 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-[#d4c09e]/60 focus:bg-zinc-900">
                <option>UF 8.000 - 12.000</option>
                <option>UF 12.000 - 18.000</option>
                <option>UF 18.000 - 25.000</option>
                <option>UF 25.000+</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                className="h-11 w-full rounded-xl bg-[#d4c09e] px-4 text-sm font-semibold text-zinc-900 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ddccb1]"
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
              className="group overflow-hidden rounded-2xl border border-stone-300/15 bg-zinc-900/80 shadow-xl shadow-black/20 transition-all duration-250 hover:-translate-y-1 hover:border-[#d4c09e]/45"
            >
              <div className="relative h-56 overflow-hidden rounded-t-2xl">
                <img
                  src={propiedad.imagen}
                  alt={propiedad.titulo}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/35" />
                <span className="absolute left-4 top-4 rounded-full border border-[#d4c09e]/40 bg-black/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-100">
                  {propiedad.etiqueta}
                </span>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <p className="text-2xl font-semibold text-[#d4c09e]">{propiedad.precio}</p>
                <div>
                  <h2 className="text-base font-semibold leading-tight text-white sm:text-lg">{propiedad.titulo}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{propiedad.ubicacion}</p>
                </div>

                <ul className="grid grid-cols-3 gap-2 rounded-xl border border-stone-300/10 bg-zinc-950/60 p-3 text-center text-xs text-zinc-300 sm:text-sm">
                  <li>
                    <p className="font-medium text-white">{propiedad.habitaciones}</p>
                    <p>Habitaciones</p>
                  </li>
                  <li>
                    <p className="font-medium text-white">{propiedad.banos}</p>
                    <p>Baños</p>
                  </li>
                  <li>
                    <p className="font-medium text-white">{propiedad.metros}</p>
                    <p>m²</p>
                  </li>
                </ul>

                <Link
                  href={`/inmo-demo/propiedades/${propiedad.slug}`}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300/25 bg-white/5 px-4 py-2 text-sm font-semibold text-stone-100 transition-all duration-200 hover:border-[#d4c09e]/50 hover:bg-[#d4c09e]/10 sm:w-auto sm:justify-start"
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
        <div className="rounded-3xl border border-stone-300/15 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 p-6 sm:p-10">
          <h3 className="text-xl font-semibold text-white sm:text-3xl">Asesoría personalizada para tu próxima inversión</h3>
          <p className="mt-3 max-w-3xl text-zinc-300">
            Nuestro equipo te acompaña con análisis de oportunidades, evaluación financiera y negociación estratégica
            para encontrar la propiedad ideal según tu perfil.
          </p>
          <p className="mt-3 max-w-3xl text-sm text-zinc-300/90">
            Elige una propiedad y agenda una llamada guiada para resolver plusvalía, financiamiento y plazos en una
            sola conversación.
          </p>
          <div className="mt-6">
            <Link
              href="/inmo-demo/contacto"
              className="inline-flex min-h-11 rounded-xl bg-[#d4c09e] px-6 py-3 text-sm font-semibold text-zinc-900 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ddccb1]"
            >
              Hablar con un asesor
            </Link>
          </div>

          <div className="mt-8 grid gap-2 text-sm text-zinc-300 sm:grid-cols-3 sm:gap-4">
            <p>
              <span className="font-medium text-stone-200">WhatsApp:</span> +56 9 6142 5029
            </p>
            <p>
              <span className="font-medium text-stone-200">Instagram:</span> @citaya_agenda
            </p>
            <p>
              <span className="font-medium text-stone-200">Email:</span> verf14@gmail.com
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
