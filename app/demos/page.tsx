import { DemosShowcaseSection } from "../(marketing)/components/home/demos-showcase-section";
import { FinalCtaSection } from "../(marketing)/components/home/final-cta-section";
import { MarketingHeader } from "../(marketing)/components/home/marketing-header";
import { WhatsAppFloatingButton } from "../(marketing)/components/home/whatsapp-floating-button";

export default function DemosPage() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <MarketingHeader />
      <DemosShowcaseSection />
      <FinalCtaSection />
      <WhatsAppFloatingButton />
    </main>
  );
}
