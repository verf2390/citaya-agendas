export default function ContactoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-xl rounded-2xl bg-white p-10 text-center shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Contáctanos</h1>
        <p className="mt-3 text-slate-600">Estamos listos para ayudarte a encontrar tu próxima propiedad.</p>

        <a
          href="https://wa.me/5215555555555"
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex rounded-lg bg-green-600 px-6 py-3 font-medium text-white transition hover:bg-green-700"
        >
          Escribir por WhatsApp
        </a>
      </section>
    </main>
  );
}
