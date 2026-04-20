import Link from "next/link";

export default function InmoDemoHomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-2xl rounded-2xl bg-white p-10 text-center shadow-sm">
        <h1 className="text-4xl font-bold text-slate-900">Encuentra tu propiedad ideal</h1>
        <p className="mt-4 text-lg text-slate-600">
          Explora opciones modernas y cómodas para vivir o invertir.
        </p>
        <Link
          href="/inmo-demo/propiedades"
          className="mt-8 inline-flex rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition hover:bg-blue-700"
        >
          Ver propiedades
        </Link>
      </section>
    </main>
  );
}
