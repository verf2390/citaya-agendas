import { FinalCtaSection } from "../(marketing)/components/home/final-cta-section";
import { MarketingHeader } from "../(marketing)/components/home/marketing-header";
import { ServicesGridSection } from "../(marketing)/components/home/services-grid-section";
import { WhatsAppFloatingButton } from "../(marketing)/components/home/whatsapp-floating-button";

export default function ServiciosPage() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <MarketingHeader />
      <ServicesGridSection />
      <FinalCtaSection />
      <WhatsAppFloatingButton />
    </main>
  );
}
