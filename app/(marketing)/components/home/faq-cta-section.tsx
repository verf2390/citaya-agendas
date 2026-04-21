import Link from "next/link";

const faqs = [
  {
    question: "¿Esto sirve para mi tipo de negocio?",
    answer:
      "Sí, está pensado para negocios que trabajan por agenda: estéticas, barberías, salud y servicios.",
  },
  {
    question: "¿Necesito saber de tecnología?",
    answer: "No, todo está pensado para ser simple de usar.",
  },
  {
    question: "¿Puedo empezar básico?",
    answer: "Sí, puedes partir simple y luego escalar.",
  },
  {
    question: "¿Incluye agenda online?",
    answer: "Sí, según tu caso.",
  },
  {
    question: "¿Cuánto demora?",
    answer: "Se puede lanzar una versión funcional en poco tiempo.",
  },
  {
    question: "¿Incluye soporte?",
    answer: "Sí, se puede acompañar el proceso.",
  },
] as const;

const whatsappMessage = "Hola Victor, quiero ver cómo funcionaría Citaya en mi negocio.";
const whatsappHref = `https://wa.me/56961425029?text=${encodeURIComponent(whatsappMessage)}`;

export function FaqCtaSection() {
  return (
    <section className="px-4 pb-20 pt-6 sm:px-6 sm:pb-24 sm:pt-8 lg:px-10 lg:pb-28 lg:pt-10">
      <div className="mx-auto grid w-full max-w-6xl gap-10">
        <div>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
            Preguntas frecuentes
          </h2>

          <div className="mt-6 space-y-3 sm:mt-8">
            {faqs.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-2xl border border-slate-200 bg-white p-4 transition-colors duration-200 hover:border-cyan-200 sm:p-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left text-sm font-semibold text-slate-900 sm:text-base">
                  <span>{faq.question}</span>
                  <span
                    className="text-xl leading-none text-cyan-700 transition-transform duration-200 group-open:rotate-45"
                    aria-hidden
                  >
                    +
                  </span>
                </summary>
                <p className="pt-3 text-sm leading-relaxed text-slate-600 sm:text-base">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-cyan-50/60 px-5 py-8 text-center shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)] sm:px-8 sm:py-10">
          <h3 className="text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl">
            Tu negocio puede verse profesional y vender con más orden
          </h3>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Te muestro cómo se vería esto en tu negocio (sin compromiso).
          </p>

          <div className="mx-auto mt-7 grid w-full max-w-xl gap-3 sm:mt-8 sm:flex sm:justify-center sm:gap-4">
            <Link
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_35px_-20px_rgba(8,145,178,0.95)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 active:translate-y-0 active:bg-cyan-700 sm:w-auto"
            >
              Muéstrame cómo funcionaría
            </Link>
            <a
              href="#demos"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 active:translate-y-0 sm:w-auto"
            >
              Ver demos
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
