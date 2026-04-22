import { FinalCtaSection } from "../(marketing)/components/home/final-cta-section";
import { MarketingHeader } from "../(marketing)/components/home/marketing-header";
import { PlansSection } from "../(marketing)/components/home/plans-section";
import { WhatsAppFloatingButton } from "../(marketing)/components/home/whatsapp-floating-button";

export default function PlanesPage() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <MarketingHeader />
      <PlansSection />
      <FinalCtaSection />
      <WhatsAppFloatingButton />
    </main>
  );
}
