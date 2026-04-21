import { AutomationFlowSection } from "./components/automation-flow-section";
import { BenefitsSection } from "./components/benefits-section";
import { FinalCtaSection } from "./components/final-cta-section";
import { HeroSection } from "./components/hero-section";
import { HowItWorksSection } from "./components/how-it-works-section";
import { LeadCaptureSection } from "./components/lead-capture-section";
import { ServicesSection } from "./components/services-section";
import { SocialProofSection } from "./components/social-proof-section";
import { TrustIndicatorsSection } from "./components/trust-indicators-section";

export default function ServiciosDemoPage() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <HeroSection />
      <TrustIndicatorsSection />
      <BenefitsSection />
      <HowItWorksSection />
      <ServicesSection />
      <LeadCaptureSection />
      <AutomationFlowSection />
      <SocialProofSection />
      <FinalCtaSection />
    </main>
  );
}
