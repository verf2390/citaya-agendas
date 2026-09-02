import { FaqListSection } from "../(marketing)/components/home/faq-list-section";
import { FinalCtaSection } from "../(marketing)/components/home/final-cta-section";
import { MarketingHeader } from "../(marketing)/components/home/marketing-header";
import { WhatsAppFloatingButton } from "../(marketing)/components/home/whatsapp-floating-button";

export default function FaqPage() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <MarketingHeader />
      <FaqListSection />
      <FinalCtaSection />
      <WhatsAppFloatingButton />
    </main>
  );
}
