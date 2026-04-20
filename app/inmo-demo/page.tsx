import Link from "next/link";

export default function InmoDemoHomePage() {
  const propiedadesDestacadas = [
    {
      id: 1,
      titulo: "Penthouse Vista Panorámica",
      precio: "UF 24.900",
      ubicacion: "Las Condes, Santiago",
      habitaciones: 4,
      banos: 3,
      metros: 285,
    },
    {
      id: 2,
      titulo: "Residencia Jardín Privado",
      precio: "UF 18.400",
      ubicacion: "Lo Barnechea, Santiago",
      habitaciones: 5,
      banos: 4,
      metros: 340,
    },
    {
      id: 3,
      titulo: "Departamento Signature",
      precio: "UF 15.200",
      ubicacion: "Vitacura, Santiago",
      habitaciones: 3,
      banos: 3,
      metros: 210,
    },
  ];

  return (
    <main className="bg-neutral-950 text-white">
      <section className="relative isolate flex min-h-screen items-center overflow-hidden px-6 py-20 sm:px-10 lg:px-16">
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top_right,rgba(212,192,158,0.25),transparent_42%),radial-gradient(circle_at_left,rgba(120,113,108,0.25),transparent_40%),linear-gradient(135deg,#0a0a0a_0%,#171717_42%,#262626_100%)]" />
        <div className="absolute inset-0 -z-10 bg-black/45" />

        <div className="mx-auto w-full max-w-6xl">
          <div className="max-w-3xl">
            <p className="inline-flex rounded-full border border-stone-300/20 bg-stone-200/10 px-4 py-1 text-xs uppercase tracking-[0.22em] text-stone-200">
              Brokerage Inmobiliario Premium
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-7xl">
              Encuentra tu propiedad ideal
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-relaxed text-stone-200 sm:text-lg">
              Descubre propiedades exclusivas diseñadas para quienes valoran lujo, patrimonio y
              oportunidades de inversión con asesoría estratégica de primer nivel.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/inmo-demo/propiedades"
                className="inline-flex items-center justify-center rounded-md bg-stone-100 px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-white"
              >
                Ver propiedades
              </Link>
              <Link
                href="/inmo-demo/contacto"
                className="inline-flex items-center justify-center rounded-md border border-stone-300/30 bg-white/5 px-6 py-3 text-sm font-semibold text-stone-100 transition hover:border-stone-100/70 hover:bg-white/10"
              >
                Contactar
              </Link>
            </div>

            <div className="mt-12 rounded-2xl border border-stone-300/20 bg-black/30 p-4 backdrop-blur-sm sm:p-5">
              <form className="flex flex-col gap-3 sm:flex-row" action="#" method="get">
                <label htmlFor="busqueda-home" className="sr-only">
                  Buscar propiedad
                </label>
                <input
                  id="busqueda-home"
                  type="text"
                  placeholder="Buscar por ubicación, comuna..."
                  className="w-full rounded-md border border-stone-300/20 bg-stone-100/10 px-4 py-3 text-sm text-stone-100 placeholder:text-stone-300/60 outline-none ring-offset-0 transition focus:border-stone-200/60"
                />
                <button
                  type="button"
                  className="rounded-md bg-[#d4c09e] px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-[#ddccb1] sm:self-stretch"
                >
                  Buscar
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 lg:px-16">
        <div className="mb-10 flex items-end justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-stone-300">Selección exclusiva</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
              Propiedades destacadas
            </h2>
          </div>
          <Link
            href="/inmo-demo/propiedades"
            className="hidden text-sm font-medium text-stone-300 transition hover:text-stone-100 sm:inline-flex"
          >
            Ver catálogo completo
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {propiedadesDestacadas.map((propiedad) => (
            <article
              key={propiedad.id}
              className="group overflow-hidden rounded-2xl border border-stone-300/15 bg-neutral-900/70 shadow-[0_18px_45px_-30px_rgba(0,0,0,0.9)]"
            >
              <div className="h-48 bg-[linear-gradient(120deg,#262626,#3f3f46,#525252)]" />
              <div className="space-y-5 p-6">
                <div>
                  <p className="text-sm uppercase tracking-[0.17em] text-stone-300/80">{propiedad.ubicacion}</p>
                  <h3 className="mt-2 text-2xl font-medium text-stone-100">{propiedad.titulo}</h3>
                  <p className="mt-3 text-xl font-semibold text-[#d4c09e]">{propiedad.precio}</p>
                </div>

                <dl className="grid grid-cols-3 gap-3 rounded-xl bg-black/25 p-4 text-center">
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-stone-400">Hab.</dt>
                    <dd className="mt-1 text-sm font-medium text-stone-100">{propiedad.habitaciones}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-stone-400">Baños</dt>
                    <dd className="mt-1 text-sm font-medium text-stone-100">{propiedad.banos}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-stone-400">m²</dt>
                    <dd className="mt-1 text-sm font-medium text-stone-100">{propiedad.metros}</dd>
                  </div>
                </dl>

                <Link
                  href="/inmo-demo/propiedades"
                  className="inline-flex w-full items-center justify-center rounded-md border border-stone-300/30 bg-white/5 px-4 py-3 text-sm font-semibold text-stone-100 transition group-hover:border-[#d4c09e]/50 group-hover:bg-[#d4c09e]/10"
                >
                  Ver propiedad
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-stone-300/10 bg-neutral-900/60 px-6 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
            Asesoría inmobiliaria de alto nivel
          </h2>
          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-stone-300 sm:text-lg">
            Combinamos análisis de mercado, negociación experta y acompañamiento personalizado para
            proteger tu inversión y maximizar cada decisión inmobiliaria con total confianza.
          </p>
        </div>
      </section>

      <section className="px-6 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 rounded-3xl border border-[#d4c09e]/25 bg-[linear-gradient(140deg,#1c1917,#292524)] px-8 py-12 text-center shadow-[0_25px_80px_-40px_rgba(0,0,0,0.95)] sm:px-14">
          <p className="text-xs uppercase tracking-[0.22em] text-stone-300">Da el siguiente paso</p>
          <h2 className="text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
            Agenda una asesoría personalizada para tu próxima inversión
          </h2>
          <p className="max-w-2xl text-base text-stone-300">
            Nuestro equipo está listo para ayudarte a encontrar oportunidades únicas alineadas con
            tus objetivos patrimoniales.
          </p>
          <Link
            href="/inmo-demo/contacto"
            className="inline-flex items-center justify-center rounded-md bg-[#d4c09e] px-7 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-[#ddccb1]"
          >
            Contactar ahora
          </Link>
        </div>
      </section>
    </main>
  );
}
