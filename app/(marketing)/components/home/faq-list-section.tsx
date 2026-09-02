import { faqs } from "./marketing-content";

export function FaqListSection() {
  return (
    <section className="bg-white px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-10 lg:px-10 lg:pb-28">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
          Preguntas frecuentes
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
          Todo lo esencial para entender cómo funciona Citaya y cómo te podemos acompañar.
        </p>

        <div className="mt-8 space-y-4">
          {faqs.map((faq) => (
            <details key={faq.question} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <summary className="cursor-pointer list-none text-base font-semibold text-slate-900">{faq.question}</summary>
              <p className="pt-3 text-sm leading-relaxed text-slate-600 sm:text-base">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
