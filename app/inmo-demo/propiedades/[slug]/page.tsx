import Link from "next/link";

type PropiedadDetallePageProps = {
  params: {
    slug: string;
  };
};

type Propiedad = {
  slug: string;
  titulo: string;
  ubicacion: string;
  precio: string;
  badge?: "Destacada" | "Exclusiva";
  habitaciones: number;
  banos: number;
  metros: number;
  estacionamientos: number;
  tipo: string;
  descripcion: string;
};

const propiedades: Propiedad[] = [
  {
    slug: "penthouse-vista-andes-las-condes",
    titulo: "Penthouse Vista Andes",
    ubicacion: "Las Condes, Santiago",
    precio: "UF 24.900",
    badge: "Exclusiva",
    habitaciones: 4,
    banos: 4,
    metros: 285,
    estacionamientos: 3,
    tipo: "Penthouse",
    descripcion:
      "Residencia de alto estándar con terrazas panorámicas, terminaciones nobles y una atmósfera diseñada para quienes valoran privacidad, luz natural y una conexión privilegiada con la ciudad. Ideal para vivir con amplitud o consolidar una inversión de categoría en uno de los sectores más cotizados de Santiago.",
  },
  {
    slug: "casa-jardin-privado-lo-barnechea",
    titulo: "Casa Jardín Privado",
    ubicacion: "Lo Barnechea, Santiago",
    precio: "UF 19.800",
    badge: "Destacada",
    habitaciones: 5,
    banos: 5,
    metros: 340,
    estacionamientos: 4,
    tipo: "Casa",
    descripcion:
      "Propiedad familiar de arquitectura contemporánea, con jardín consolidado, piscina climatizada y espacios sociales de gran escala. Una propuesta única para disfrutar estilo de vida residencial premium con acceso directo a colegios, servicios y áreas verdes.",
  },
  {
    slug: "departamento-autor-vitacura",
    titulo: "Departamento de Autor",
    ubicacion: "Vitacura, Santiago",
    precio: "UF 13.450",
    habitaciones: 3,
    banos: 3,
    metros: 168,
    estacionamientos: 2,
    tipo: "Departamento",
    descripcion:
      "Diseño interior sofisticado, materiales de primera línea y una distribución inteligente pensada para confort urbano de lujo. Perfecto para quienes buscan elegancia discreta, conectividad y valor patrimonial en una ubicación estratégica.",
  },
];

export default function PropiedadDetallePage({ params }: PropiedadDetallePageProps) {
  const propiedad = propiedades.find((item) => item.slug === params.slug);

  if (!propiedad) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-4 py-14 sm:px-6 sm:py-16">
        <section className="w-full rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-950 to-neutral-900 p-6 text-neutral-100 shadow-2xl sm:p-10">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-400">inmo demo</p>
          <h1 className="mt-4 text-2xl font-semibold sm:text-3xl md:text-4xl">Propiedad no encontrada</h1>
          <p className="mt-4 max-w-2xl text-neutral-300">
            No encontramos una propiedad asociada al slug <span className="font-mono">{params.slug}</span>.
            Puedes volver al listado para seguir explorando oportunidades exclusivas.
          </p>
          <Link
            href="/inmo-demo/propiedades"
            className="mt-8 inline-flex min-h-11 rounded-full border border-neutral-600 px-6 py-3 text-sm font-medium text-neutral-100 transition hover:border-neutral-400 hover:bg-neutral-800"
          >
            ← Volver al catálogo
          </Link>
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

  const relacionadas = propiedades.filter((item) => item.slug !== propiedad.slug).slice(0, 3);

  return (
    <main className="bg-neutral-950 text-neutral-100">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 md:px-8 md:py-14">
        <Link
          href="/inmo-demo/propiedades"
          className="inline-flex min-h-11 items-center rounded-full border border-neutral-700 px-4 py-2 text-xs uppercase tracking-[0.18em] text-neutral-300 transition hover:border-neutral-500 hover:text-white"
        >
          ← Volver a propiedades
        </Link>

        <section className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
          <div className="space-y-6 lg:space-y-8">
            <article className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black p-6 shadow-2xl sm:p-8 md:p-10">
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-xs uppercase tracking-[0.24em] text-neutral-400">Ficha Premium</p>
                {propiedad.badge ? (
                  <span className="rounded-full border border-amber-300/50 bg-amber-100/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-amber-200">
                    {propiedad.badge}
                  </span>
                ) : null}
              </div>

              <h1 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl md:text-5xl">{propiedad.titulo}</h1>
              <p className="mt-4 text-base text-neutral-300 md:text-lg">{propiedad.ubicacion}</p>
              <p className="mt-7 text-2xl font-semibold text-amber-100 sm:text-3xl md:text-4xl">{propiedad.precio}</p>
            </article>

            <section className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2 rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-800 via-neutral-900 to-neutral-950 p-5 shadow-xl sm:p-8">
                <p className="text-xs uppercase tracking-[0.22em] text-neutral-300">Galería Principal</p>
                <div className="mt-6 h-56 rounded-2xl border border-neutral-700 bg-gradient-to-tr from-neutral-700/40 via-neutral-600/20 to-amber-200/20 sm:mt-10 sm:h-72" />
              </div>

              <div className="grid gap-4">
                <div className="h-36 rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-800 to-neutral-900 p-4" />
                <div className="h-36 rounded-2xl border border-neutral-800 bg-gradient-to-tr from-neutral-900 to-neutral-700 p-4" />
                <div className="h-36 rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-800 via-neutral-900 to-black p-4" />
              </div>
            </section>

            <section className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-5 sm:p-8">
              <h2 className="text-xl font-semibold">Características</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Feature label="Habitaciones" value={`${propiedad.habitaciones}`} />
                <Feature label="Baños" value={`${propiedad.banos}`} />
                <Feature label="Superficie" value={`${propiedad.metros} m²`} />
                <Feature label="Estacionamientos" value={`${propiedad.estacionamientos}`} />
                <Feature label="Tipo" value={propiedad.tipo} />
              </div>
            </section>

            <section className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-5 sm:p-8">
              <h2 className="text-xl font-semibold">Descripción</h2>
              <p className="mt-5 text-neutral-300">{propiedad.descripcion}</p>
            </section>
          </div>

          <aside className="order-first h-fit rounded-3xl border border-neutral-800 bg-neutral-900/80 p-5 shadow-2xl sm:p-6 lg:order-none lg:sticky lg:top-8">
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">Asesoría personalizada</p>
            <h3 className="mt-3 text-xl font-semibold sm:text-2xl">Agenda una visita privada</h3>
            <p className="mt-3 text-sm text-neutral-300">
              Nuestro equipo te acompaña en cada etapa para encontrar una propiedad que combine estilo,
              rentabilidad y visión de largo plazo.
            </p>
            <p className="mt-3 text-sm text-neutral-300/90">
              Te ayudamos a evaluar precio, potencial de valorización y próximos pasos para cerrar con
              confianza.
            </p>

            <div className="mt-6 space-y-3">
              <a
                href="https://wa.me/56961425029"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 w-full justify-center rounded-full border border-emerald-300/30 bg-emerald-500/95 px-5 py-3 text-sm font-semibold text-emerald-950 shadow-[0_16px_30px_-20px_rgba(16,185,129,0.8)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-400"
              >
                Escribir por WhatsApp
              </a>
              <a
                href="mailto:verf14@gmail.com"
                className="inline-flex min-h-11 w-full justify-center rounded-full border border-neutral-600 px-5 py-3 text-sm font-semibold text-neutral-100 transition hover:border-neutral-400 hover:bg-neutral-800"
              >
                Contactar por Email
              </a>
            </div>

            <div className="mt-6 rounded-2xl border border-neutral-800 bg-black/30 p-4 text-sm text-neutral-300">
              <p>
                Instagram: <span className="font-medium text-neutral-100">@citaya_agenda</span>
              </p>
              <p className="mt-2">Email: verf14@gmail.com</p>
            </div>
          </aside>
        </section>

        <section className="mt-8 rounded-3xl border border-neutral-800 bg-neutral-900/60 p-5 sm:mt-10 sm:p-8">
          <h2 className="text-xl font-semibold sm:text-2xl">Propiedades relacionadas</h2>
          <p className="mt-2 text-sm text-neutral-400">Opciones similares que podrían interesarte.</p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {relacionadas.map((item) => (
              <Link
                key={item.slug}
                href={`/inmo-demo/propiedades/${item.slug}`}
                className="group block min-h-11 rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-black p-5 transition hover:border-neutral-600"
              >
                <p className="text-sm uppercase tracking-[0.18em] text-neutral-400">{item.tipo}</p>
                <h3 className="mt-2 text-lg font-medium text-neutral-100 group-hover:text-amber-100">
                  {item.titulo}
                </h3>
                <p className="mt-1 text-sm text-neutral-400">{item.ubicacion}</p>
                <p className="mt-4 text-base font-semibold text-amber-100">{item.precio}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>

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

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-neutral-800 bg-black/30 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">{label}</p>
      <p className="mt-2 text-xl font-semibold text-neutral-100">{value}</p>
    </article>
  );
}
