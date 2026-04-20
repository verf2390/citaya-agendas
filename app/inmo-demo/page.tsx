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
      <section className="relative isolate flex min-h-screen items-center overflow-hidden px-4 py-14 sm:px-10 sm:py-20 lg:px-16">
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top_right,rgba(212,192,158,0.25),transparent_42%),radial-gradient(circle_at_left,rgba(120,113,108,0.25),transparent_40%),linear-gradient(135deg,#0a0a0a_0%,#171717_42%,#262626_100%)]" />
        <div className="absolute inset-0 -z-10 bg-black/45" />

        <div className="mx-auto w-full max-w-6xl">
          <div className="max-w-3xl">
            <p className="inline-flex rounded-full border border-stone-300/20 bg-stone-200/10 px-4 py-1 text-xs uppercase tracking-[0.22em] text-stone-200">
              Brokerage Inmobiliario Premium
            </p>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-5xl lg:text-7xl">
              Encuentra tu propiedad ideal
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-relaxed text-stone-200 sm:mt-6 sm:text-lg">
              Descubre propiedades exclusivas diseñadas para quienes valoran lujo, patrimonio y
              oportunidades de inversión con asesoría estratégica de primer nivel.
            </p>

            <div className="mt-9 flex flex-wrap gap-3 sm:mt-10 sm:gap-4">
              <Link
                href="/inmo-demo/propiedades"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#d4c09e] px-6 py-3 text-sm font-semibold text-neutral-900 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ddccb1] hover:shadow-[0_14px_28px_-18px_rgba(212,192,158,0.95)]"
              >
                Ver propiedades
              </Link>
              <Link
                href="/inmo-demo/contacto"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300/30 bg-white/5 px-6 py-3 text-sm font-semibold text-stone-100 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#d4c09e]/60 hover:bg-[#d4c09e]/10"
              >
                Contactar
              </Link>
            </div>

            <div className="mt-10 rounded-2xl border border-stone-300/20 bg-black/35 p-4 shadow-[0_24px_45px_-34px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:mt-12 sm:p-5">
              <form className="flex flex-col gap-3 sm:flex-row" action="#" method="get">
                <label htmlFor="busqueda-home" className="sr-only">
                  Buscar propiedad
                </label>
                <input
                  id="busqueda-home"
                  type="text"
                  placeholder="Buscar por ubicación, comuna..."
                  className="h-11 w-full rounded-lg border border-stone-300/20 bg-stone-100/10 px-4 py-3 text-sm text-stone-100 placeholder:text-stone-300/60 outline-none ring-offset-0 transition-all duration-200 focus:border-[#d4c09e]/55 focus:bg-white/10"
                />
                <button
                  type="button"
                  className="min-h-11 rounded-lg bg-[#d4c09e] px-6 py-3 text-sm font-semibold text-neutral-900 transition-all duration-200 hover:bg-[#ddccb1] sm:self-stretch"
                >
                  Buscar
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-10 sm:py-20 lg:px-16">
        <div className="mb-8 flex items-end justify-between gap-5 sm:mb-10">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-stone-300">Selección exclusiva</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
              Propiedades destacadas
            </h2>
          </div>
          <Link
            href="/inmo-demo/propiedades"
            className="hidden text-sm font-medium text-stone-300 transition-colors duration-200 hover:text-[#d4c09e] sm:inline-flex"
          >
            Ver catálogo completo
          </Link>
        </div>

        <div className="grid gap-5 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
          {propiedadesDestacadas.map((propiedad) => (
            <article
              key={propiedad.id}
            className="group overflow-hidden rounded-2xl border border-stone-300/15 bg-neutral-900/75 shadow-[0_18px_45px_-30px_rgba(0,0,0,0.9)] transition-all duration-250 hover:-translate-y-0.5 hover:border-[#d4c09e]/45"
            >
              <div className="h-48 bg-[linear-gradient(120deg,#262626,#3f3f46,#525252)] transition-transform duration-300 group-hover:scale-[1.02]" />
              <div className="space-y-5 p-5 sm:p-6">
                <div>
                  <p className="text-sm uppercase tracking-[0.17em] text-stone-300/80">{propiedad.ubicacion}</p>
                  <h3 className="mt-2 text-xl font-medium text-stone-100 sm:text-2xl">{propiedad.titulo}</h3>
                  <p className="mt-3 text-xl font-semibold text-[#d4c09e]">{propiedad.precio}</p>
                </div>

                <dl className="grid grid-cols-3 gap-3 rounded-xl border border-stone-300/10 bg-black/25 p-4 text-center">
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
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300/30 bg-white/5 px-4 py-3 text-sm font-semibold text-stone-100 transition-all duration-200 group-hover:border-[#d4c09e]/50 group-hover:bg-[#d4c09e]/10"
                >
                  Ver propiedad
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-stone-300/10 bg-neutral-900/60 px-4 py-14 sm:px-10 sm:py-20 lg:px-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
            Asesoría inmobiliaria de alto nivel
          </h2>
          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-stone-300 sm:text-lg">
            Combinamos análisis de mercado, negociación experta y acompañamiento personalizado para
            proteger tu inversión y maximizar cada decisión inmobiliaria con total confianza.
          </p>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-10 sm:py-20 lg:px-16">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 rounded-3xl border border-[#d4c09e]/25 bg-[linear-gradient(140deg,#1c1917,#292524)] px-5 py-9 text-center shadow-[0_25px_80px_-40px_rgba(0,0,0,0.95)] sm:px-14 sm:py-12">
          <p className="text-xs uppercase tracking-[0.22em] text-stone-300">Da el siguiente paso</p>
          <h2 className="text-2xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
            Agenda una asesoría personalizada para tu próxima inversión
          </h2>
          <p className="max-w-2xl text-base text-stone-300">
            Nuestro equipo está listo para ayudarte a encontrar oportunidades únicas alineadas con
            tus objetivos patrimoniales.
          </p>
          <p className="text-sm text-stone-300/90">
            ¿Prefieres una respuesta inmediata? Escríbenos directo por WhatsApp y te orientamos en
            minutos.
          </p>
          <Link
            href="/inmo-demo/contacto"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#d4c09e] px-7 py-3 text-sm font-semibold text-neutral-900 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ddccb1]"
          >
            Contactar ahora
          </Link>
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
