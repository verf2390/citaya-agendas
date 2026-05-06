import { RevealOnScroll } from "./reveal-on-scroll";

const pains = [
  "Respondes mensajes cuando estás atendiendo.",
  "Te preguntan precios y horarios una y otra vez.",
  "Se pierden clientes porque respondes tarde.",
  "Las reservas quedan mezcladas en WhatsApp.",
  "No sabes quién confirmó y quién no.",
] as const;

export function TrustIndicatorsSection() {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-10 lg:py-20">
      <div className="mx-auto max-w-6xl space-y-6">
        <RevealOnScroll className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.6)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Problema real</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Si tus reservas viven en WhatsApp, estás trabajando de más
          </h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {pains.map((pain) => (
              <div key={pain} className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm font-medium text-rose-900">
                {pain}
              </div>
            ))}
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
