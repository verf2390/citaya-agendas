import { BenefitsSection } from "./components/benefits-section";
import { FinalCtaSection } from "./components/final-cta-section";
import { HeroSection } from "./components/hero-section";
import { LiveAgendaDemoSection } from "./components/live-agenda-demo-section";
import { ServicesSection } from "./components/services-section";
import { SocialProofSection } from "./components/social-proof-section";
import { TrustIndicatorsSection } from "./components/trust-indicators-section";

export default function ServiciosDemoPage() {
  return (
    <main>
      <HeroSection />
      <TrustIndicatorsSection />
      <ServicesSection />
      <LiveAgendaDemoSection />
      <BenefitsSection />
      <SocialProofSection />
      <FinalCtaSection />
    </main>
  );
}
