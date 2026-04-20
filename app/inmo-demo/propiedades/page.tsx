import Link from "next/link";

const propiedadesMock = [
  { slug: "departamento-centro", nombre: "Departamento en el centro", precio: "$120,000" },
  { slug: "casa-jardin", nombre: "Casa con jardín", precio: "$210,000" },
  { slug: "loft-moderno", nombre: "Loft moderno", precio: "$150,000" },
];

export default function PropiedadesPage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Propiedades disponibles</h1>

      <section className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {propiedadesMock.map((propiedad) => (
          <article key={propiedad.slug} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-800">{propiedad.nombre}</h2>
            <p className="mt-2 text-slate-600">Precio estimado: {propiedad.precio}</p>
            <Link
              href={`/inmo-demo/propiedades/${propiedad.slug}`}
              className="mt-4 inline-flex text-blue-600 hover:text-blue-700"
            >
              Ver detalle
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
