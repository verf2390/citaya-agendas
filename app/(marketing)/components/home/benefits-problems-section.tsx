const problemSolutionBlocks = [
  {
    problem: "Se me van clientes porque no alcanzo a responder",
    solution: "Captación clara + agenda online + menos dependencia de respuestas manuales",
  },
  {
    problem: "Paso el día coordinando horarios por mensaje",
    solution: "Sistema donde el cliente agenda solo sin fricción",
  },
  {
    problem: "Tengo presencia online, pero no me genera negocio",
    solution: "Web enfocada en conversión con llamados a la acción claros",
  },
  {
    problem: "Todo depende de mí y se desordena fácil",
    solution: "Procesos simples que ordenan la operación diaria",
  },
] as const;

export function BenefitsProblemsSection() {
  return (
    <section className="px-4 pb-14 pt-6 sm:px-6 sm:pb-16 sm:pt-8 lg:px-10 lg:pb-20 lg:pt-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
            Menos desorden, más clientes atendidos
          </h2>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5 lg:gap-6">
          {problemSolutionBlocks.map((block) => (
            <article
              key={block.problem}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
            >
              <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Problema</p>
                <p className="mt-1 text-sm leading-relaxed text-white sm:text-base">“{block.problem}”</p>
              </div>

              <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Solución</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-700 sm:text-base">{block.solution}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
