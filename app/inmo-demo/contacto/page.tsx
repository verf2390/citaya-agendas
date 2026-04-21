export default function ContactoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,rgba(212,192,158,0.2),transparent_35%),linear-gradient(160deg,#09090b,#18181b,#0a0a0a)] px-4 py-8 text-white sm:px-6 sm:py-10">
      <section className="w-full max-w-xl rounded-3xl border border-stone-300/20 bg-zinc-900/70 p-5 text-center shadow-[0_24px_50px_-34px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-10">
        <p className="text-xs uppercase tracking-[0.22em] text-stone-300">Asesoría premium</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-stone-100 sm:text-4xl">Contáctanos</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-300 sm:text-base">
          Estamos listos para ayudarte a encontrar tu próxima propiedad con una asesoría estratégica y personalizada.
        </p>
        <p className="mt-2 text-sm text-stone-300/90">
          Cuéntanos tu presupuesto, zona de interés y plazo: te responderemos con opciones reales para avanzar hoy.
        </p>

        <div className="mt-6 rounded-2xl border border-stone-300/15 bg-black/25 px-4 py-4 text-left text-sm text-stone-200 sm:mt-7 sm:px-5 sm:text-base">
          <p>
            <span className="font-medium text-[#d4c09e]">Horario:</span> Lunes a Viernes · 09:00 a 19:00
          </p>
          <p className="mt-2">
            <span className="font-medium text-[#d4c09e]">Respuesta promedio:</span> Menos de 30 minutos
          </p>
          <p className="mt-3">
            <span className="font-medium text-[#d4c09e]">WhatsApp:</span>{" "}
            <a
              href="https://wa.me/56961425029"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200/30 bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-200 transition-all duration-200 hover:border-emerald-200/45 hover:bg-emerald-500/20"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M16.75 13.96c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.55.13s-.64.81-.78.98c-.14.17-.29.19-.54.06a6.86 6.86 0 0 1-2.02-1.24 7.62 7.62 0 0 1-1.4-1.74c-.15-.25-.02-.38.11-.5.11-.11.25-.28.38-.42.12-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.55-1.33-.76-1.82-.2-.48-.4-.42-.55-.43h-.47c-.16 0-.42.06-.64.31-.22.25-.84.82-.84 1.98 0 1.17.86 2.3.98 2.46.12.17 1.7 2.59 4.11 3.63 2.41 1.04 2.41.69 2.84.65.43-.04 1.39-.57 1.58-1.12.2-.55.2-1.02.14-1.12-.06-.11-.23-.17-.48-.3Z" />
                <path d="M20.52 3.48A11.9 11.9 0 0 0 12.06 0C5.48 0 .14 5.33.14 11.91c0 2.1.55 4.16 1.6 5.97L0 24l6.3-1.65a11.86 11.86 0 0 0 5.76 1.47h.01c6.58 0 11.92-5.34 11.92-11.91 0-3.18-1.24-6.16-3.47-8.43ZM12.07 21.8h-.01a9.9 9.9 0 0 1-5.04-1.38l-.36-.22-3.74.98 1-3.65-.24-.38a9.86 9.86 0 0 1-1.51-5.24c0-5.46 4.44-9.89 9.9-9.89 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.9 6.99c0 5.46-4.45 9.89-9.9 9.89Z" />
              </svg>
              +56 9 6142 5029
            </a>
          </p>
          <p className="mt-2">
            <span className="font-medium text-[#d4c09e]">Instagram:</span>{" "}
            <a
              href="https://instagram.com/citaya_agenda"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-stone-200 transition-colors duration-200 hover:text-[#d4c09e]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm8.5 1.8h-8.5A3.95 3.95 0 0 0 3.8 7.75v8.5a3.95 3.95 0 0 0 3.95 3.95h8.5a3.95 3.95 0 0 0 3.95-3.95v-8.5a3.95 3.95 0 0 0-3.95-3.95Zm-4.25 3.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2Zm0 1.8a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Zm5.7-2.16a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z" />
              </svg>
              @citaya_agenda
            </a>
          </p>
          <p className="mt-2">
            <span className="font-medium text-[#d4c09e]">Email:</span>{" "}
            <a
              href="mailto:verf14@gmail.com"
              className="inline-flex items-center gap-1.5 text-stone-200 transition-colors duration-200 hover:text-[#d4c09e]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M3 5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25v13.5A2.25 2.25 0 0 1 18.75 21H5.25A2.25 2.25 0 0 1 3 18.75V5.25Zm2.07-.45 6.53 5.22a.63.63 0 0 0 .8 0l6.53-5.22H5.07Zm14.13 1.14-5.95 4.75a2.43 2.43 0 0 1-3.03 0L4.8 5.94v12.81c0 .25.2.45.45.45h13.5c.25 0 .45-.2.45-.45V5.94Z" />
              </svg>
              verf14@gmail.com
            </a>
          </p>
        </div>

        <a
          href="https://wa.me/56961425029"
          target="_blank"
          rel="noreferrer"
          className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#d4c09e] px-6 py-3 text-sm font-semibold text-zinc-900 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ddccb1] hover:shadow-[0_14px_28px_-16px_rgba(212,192,158,0.9)] sm:mt-8 sm:w-auto"
        >
          Solicitar asesoría por WhatsApp
        </a>
        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-stone-400">
          Atención personalizada • Sin compromiso inicial
        </p>
      </section>

      <a
        href="https://wa.me/56961425029"
        target="_blank"
        rel="noreferrer"
        aria-label="Contactar por WhatsApp"
        className="fixed bottom-4 right-4 z-50 inline-flex min-h-11 items-center gap-2.5 rounded-full border border-emerald-200/35 bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-emerald-950 shadow-[0_16px_35px_-18px_rgba(16,185,129,0.72)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-400/95 sm:bottom-5 sm:right-5 sm:px-4 sm:py-2.5"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current">
          <path d="M16.75 13.96c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.55.13s-.64.81-.78.98c-.14.17-.29.19-.54.06a6.86 6.86 0 0 1-2.02-1.24 7.62 7.62 0 0 1-1.4-1.74c-.15-.25-.02-.38.11-.5.11-.11.25-.28.38-.42.12-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.55-1.33-.76-1.82-.2-.48-.4-.42-.55-.43h-.47c-.16 0-.42.06-.64.31-.22.25-.84.82-.84 1.98 0 1.17.86 2.3.98 2.46.12.17 1.7 2.59 4.11 3.63 2.41 1.04 2.41.69 2.84.65.43-.04 1.39-.57 1.58-1.12.2-.55.2-1.02.14-1.12-.06-.11-.23-.17-.48-.3Z" />
          <path d="M20.52 3.48A11.9 11.9 0 0 0 12.06 0C5.48 0 .14 5.33.14 11.91c0 2.1.55 4.16 1.6 5.97L0 24l6.3-1.65a11.86 11.86 0 0 0 5.76 1.47h.01c6.58 0 11.92-5.34 11.92-11.91 0-3.18-1.24-6.16-3.47-8.43ZM12.07 21.8h-.01a9.9 9.9 0 0 1-5.04-1.38l-.36-.22-3.74.98 1-3.65-.24-.38a9.86 9.86 0 0 1-1.51-5.24c0-5.46 4.44-9.89 9.9-9.89 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.9 6.99c0 5.46-4.45 9.89-9.9 9.89Z" />
        </svg>
        <span>WhatsApp</span>
      </a>
    </main>
  );
}
