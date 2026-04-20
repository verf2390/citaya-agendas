import Link from "next/link";

type PropiedadDetallePageProps = {
  params: {
    slug: string;
  };
};

const relacionadas = [
  {
    slug: "residencia-jardin-privado",
    titulo: "Residencia con jardín privado",
    precio: "UF 24.500",
    ubicacion: "Lo Barnechea, Santiago",
  },
  {
    slug: "departamento-boutique-vitacura",
    titulo: "Departamento boutique en Vitacura",
    precio: "UF 12.300",
    ubicacion: "Vitacura, Santiago",
  },
];

export default function PropiedadDetallePage({ params }: PropiedadDetallePageProps) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href="/inmo-demo/propiedades"
          className="inline-flex items-center text-sm font-medium text-stone-300 transition-colors duration-200 hover:text-[#d4c09e]"
        >
          ← Volver a propiedades
        </Link>

        <section className="mt-5 rounded-2xl border border-stone-300/20 bg-zinc-900/75 p-6 shadow-[0_22px_45px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:mt-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-stone-300">Slug dinámico</p>
          <p className="mt-2 rounded-lg border border-stone-300/20 bg-black/25 px-3 py-2 font-mono text-sm text-stone-100 sm:text-base">
            {params.slug}
          </p>

          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">Detalle de la propiedad</h1>
          <p className="mt-3 text-sm leading-relaxed text-stone-300 sm:text-base">
            Esta es una página de ejemplo para mostrar información detallada de una propiedad.
          </p>

          <div className="mt-7 rounded-xl border border-[#d4c09e]/35 bg-[#d4c09e]/10 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-stone-200/90">Precio referencial</p>
            <p className="mt-2 text-3xl font-semibold text-[#d4c09e] sm:text-4xl">UF 18.900</p>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="https://wa.me/56961425029"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center rounded-xl bg-[#d4c09e] px-5 py-3 text-sm font-semibold text-zinc-900 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ddccb1] hover:shadow-[0_14px_28px_-16px_rgba(212,192,158,0.9)] sm:w-auto"
            >
              Escribir por WhatsApp
            </a>
            <button
              type="button"
              className="inline-flex w-full items-center justify-center rounded-xl border border-stone-300/30 bg-white/5 px-5 py-3 text-sm font-semibold text-stone-100 transition-all duration-200 hover:border-[#d4c09e]/60 hover:bg-[#d4c09e]/10 sm:w-auto"
            >
              Solicitar visita
            </button>
          </div>
        </section>

        <section className="mt-7 sm:mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight text-stone-100 sm:text-2xl">Propiedades relacionadas</h2>
            <Link
              href="/inmo-demo/propiedades"
              className="text-sm font-medium text-stone-300 transition-colors duration-200 hover:text-[#d4c09e]"
            >
              Ver todas
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {relacionadas.map((propiedad) => (
              <Link
                key={propiedad.slug}
                href={`/inmo-demo/propiedades/${propiedad.slug}`}
                className="group rounded-2xl border border-stone-300/20 bg-zinc-900/70 p-4 shadow-[0_20px_35px_-28px_rgba(0,0,0,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#d4c09e]/50 hover:bg-zinc-900"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-stone-400">{propiedad.ubicacion}</p>
                <h3 className="mt-2 text-base font-medium text-stone-100 transition-colors duration-200 group-hover:text-white">
                  {propiedad.titulo}
                </h3>
                <p className="mt-3 text-lg font-semibold text-[#d4c09e]">{propiedad.precio}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
