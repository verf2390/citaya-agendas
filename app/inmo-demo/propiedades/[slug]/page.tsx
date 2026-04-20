import Link from "next/link";

type PropiedadDetallePageProps = {
  params: {
    slug: string;
  };
};

export default function PropiedadDetallePage({ params }: PropiedadDetallePageProps) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/inmo-demo/propiedades" className="text-sm text-blue-600 hover:text-blue-700">
        ← Volver a propiedades
      </Link>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm uppercase tracking-wide text-slate-500">Slug dinámico</p>
        <p className="mt-1 font-mono text-slate-900">{params.slug}</p>

        <h1 className="mt-6 text-3xl font-bold text-slate-900">Detalle de la propiedad</h1>
        <p className="mt-3 text-slate-600">
          Esta es una página de ejemplo para mostrar información detallada de una propiedad.
        </p>
      </section>
    </main>
  );
}
