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
    gradiente: "from-zinc-700 via-zinc-800 to-black",
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
    gradiente: "from-stone-700 via-zinc-700 to-zinc-900",
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
    gradiente: "from-neutral-600 via-zinc-700 to-zinc-900",
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
    gradiente: "from-zinc-700 via-neutral-800 to-black",
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
    gradiente: "from-stone-600 via-zinc-700 to-zinc-900",
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
    gradiente: "from-neutral-700 via-zinc-800 to-black",
  },
];

export default function PropiedadesPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <section className="mx-auto w-full max-w-7xl px-4 pb-10 pt-16 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-8 shadow-2xl shadow-black/30 sm:p-12">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-stone-300">Colección inmobiliaria</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Propiedades disponibles</h1>
          <p className="mt-5 max-w-3xl text-base text-zinc-300 sm:text-lg">
            Selección premium de activos residenciales con alto estándar de diseño, ubicación estratégica y potencial
            sólido de valorización para vivienda e inversión.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 backdrop-blur sm:p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Ubicación
              <input
                type="text"
                placeholder="Ej: Las Condes"
                className="h-11 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-stone-400"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Tipo de propiedad
              <select className="h-11 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-stone-400">
                <option>Departamento</option>
                <option>Casa</option>
                <option>Penthouse</option>
                <option>Loft</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Rango de precio
              <select className="h-11 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-stone-400">
                <option>UF 8.000 - 12.000</option>
                <option>UF 12.000 - 18.000</option>
                <option>UF 18.000 - 25.000</option>
                <option>UF 25.000+</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                className="h-11 w-full rounded-xl bg-stone-200 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-white"
              >
                Buscar
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {propiedades.map((propiedad) => (
            <article
              key={propiedad.slug}
              className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 shadow-xl shadow-black/20"
            >
              <div className={`relative h-52 bg-gradient-to-br ${propiedad.gradiente}`}>
                <span className="absolute left-4 top-4 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-100">
                  {propiedad.etiqueta}
                </span>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.2),transparent_45%)]" />
                <div className="absolute bottom-4 left-4 text-sm text-stone-100/90">Imagen referencial</div>
              </div>

              <div className="space-y-4 p-5">
                <p className="text-2xl font-semibold text-stone-200">{propiedad.precio}</p>
                <div>
                  <h2 className="text-lg font-semibold leading-tight text-white">{propiedad.titulo}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{propiedad.ubicacion}</p>
                </div>

                <ul className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-center text-xs text-zinc-300 sm:text-sm">
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
                  className="inline-flex items-center text-sm font-semibold text-stone-200 transition group-hover:text-white"
                >
                  Ver detalle
                  <span aria-hidden="true" className="ml-1 transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 p-8 sm:p-10">
          <h3 className="text-2xl font-semibold text-white sm:text-3xl">Asesoría personalizada para tu próxima inversión</h3>
          <p className="mt-3 max-w-3xl text-zinc-300">
            Nuestro equipo te acompaña con análisis de oportunidades, evaluación financiera y negociación estratégica
            para encontrar la propiedad ideal según tu perfil.
          </p>
          <div className="mt-6">
            <Link
              href="/inmo-demo/contacto"
              className="inline-flex rounded-xl bg-stone-200 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white"
            >
              Contactar asesor
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
    </main>
  );
}
