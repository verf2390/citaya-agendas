import { FinalCtaSection } from "./components/final-cta-section";
import { HeroSection } from "./components/hero-section";
import { ServicesSection } from "./components/services-section";
import { SocialProofSection } from "./components/social-proof-section";
import { HowItWorksSection } from "./components/how-it-works-section";
import { TrustIndicatorsSection } from "./components/trust-indicators-section";

export default function ServiciosDemoPage() {
  return (
    <main>
      <HeroSection />
      <TrustIndicatorsSection />
      <HowItWorksSection />
      <ServicesSection />
      <SocialProofSection />
      <FinalCtaSection />
    </main>
  );
}
