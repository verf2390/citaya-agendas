import Link from "next/link";

const whatsappMessage = "Hola Victor, quiero más información sobre Citaya para mi negocio.";
const whatsappHref = `https://wa.me/56961425029?text=${encodeURIComponent(whatsappMessage)}`;

export function WhatsAppFloatingButton() {
  return (
    <div className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 sm:bottom-[max(1.25rem,env(safe-area-inset-bottom))] sm:right-[max(1.25rem,env(safe-area-inset-right))]">
      <Link
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Abrir WhatsApp para contactar a Citaya"
        className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_16px_38px_-18px_rgba(37,211,102,0.95)] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 active:translate-y-0"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7 fill-current">
          <path d="M19.05 4.91A9.82 9.82 0 0 0 12.03 2a9.99 9.99 0 0 0-8.67 14.95L2 22l5.23-1.36A10 10 0 0 0 12.03 22c5.5 0 9.97-4.47 9.97-9.98a9.9 9.9 0 0 0-2.95-7.11Zm-7.02 15.4a8.3 8.3 0 0 1-4.22-1.15l-.3-.18-3.1.82.83-3.03-.2-.31a8.33 8.33 0 1 1 7 3.85Zm4.57-6.24c-.25-.13-1.46-.72-1.69-.8-.22-.09-.38-.13-.55.12-.16.25-.63.8-.77.97-.14.16-.28.18-.53.06-.25-.13-1.04-.38-1.97-1.2-.72-.64-1.2-1.42-1.34-1.66-.14-.25-.02-.38.1-.5.12-.12.25-.28.37-.41.13-.14.16-.25.25-.41.08-.17.04-.31-.02-.44-.07-.12-.55-1.32-.75-1.81-.2-.48-.4-.42-.55-.43h-.47a.9.9 0 0 0-.66.31c-.23.25-.87.85-.87 2.08s.9 2.4 1.02 2.57c.13.17 1.76 2.7 4.27 3.79.6.26 1.08.42 1.44.54.6.19 1.14.16 1.57.1.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.08.14-1.18-.05-.1-.22-.16-.47-.29Z" />
        </svg>
      </Link>
    </div>
  );
}
