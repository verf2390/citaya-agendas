import { BrandHeroSection } from "./(marketing)/components/home/brand-hero-section";
import { ServicesGridSection } from "./(marketing)/components/home/services-grid-section";
import { DemosShowcaseSection } from "./(marketing)/components/home/demos-showcase-section";
import { BenefitsProblemsSection } from "./(marketing)/components/home/benefits-problems-section";
import { SocialProofSection } from "./(marketing)/components/home/social-proof-section";
import { PlansSection } from "./(marketing)/components/home/plans-section";
import { FaqCtaSection } from "./(marketing)/components/home/faq-cta-section";
import { WhatsAppFloatingButton } from "./(marketing)/components/home/whatsapp-floating-button";

export default function Home() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <BrandHeroSection />
      <ServicesGridSection />
      <DemosShowcaseSection />
      <BenefitsProblemsSection />
      <SocialProofSection />
      <PlansSection />
      <FaqCtaSection />
      <WhatsAppFloatingButton />
    </main>
  );
}
