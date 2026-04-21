import { BrandHeroSection } from "./(marketing)/components/home/brand-hero-section";
import { ServicesGridSection } from "./(marketing)/components/home/services-grid-section";
import { DemosShowcaseSection } from "./(marketing)/components/home/demos-showcase-section";
import { BenefitsProblemsSection } from "./(marketing)/components/home/benefits-problems-section";
import { SocialProofSection } from "./(marketing)/components/home/social-proof-section";
import { FaqCtaSection } from "./(marketing)/components/home/faq-cta-section";

export default function Home() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <BrandHeroSection />
      <ServicesGridSection />
      <DemosShowcaseSection />
      <BenefitsProblemsSection />
      <SocialProofSection />
      <FaqCtaSection />
    </main>
  );
}
