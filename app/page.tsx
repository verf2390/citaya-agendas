import { BrandHeroSection } from "./(marketing)/components/home/brand-hero-section";
import { FinalCtaSection } from "./(marketing)/components/home/final-cta-section";
import { HomeSummarySection } from "./(marketing)/components/home/home-summary-section";
import { MarketingHeader } from "./(marketing)/components/home/marketing-header";
import { NavigationCardsSection } from "./(marketing)/components/home/navigation-cards-section";
import { SocialProofSection } from "./(marketing)/components/home/social-proof-section";
import { WhatsAppFloatingButton } from "./(marketing)/components/home/whatsapp-floating-button";

export default function Home() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <MarketingHeader />
      <BrandHeroSection />
      <HomeSummarySection />
      <NavigationCardsSection />
      <SocialProofSection />
      <FinalCtaSection showFaqTeaser />
      <WhatsAppFloatingButton />
    </main>
  );
}
