import { AutomationFlowSection } from "./components/automation-flow-section";
import { BenefitsSection } from "./components/benefits-section";
import { FinalCtaSection } from "./components/final-cta-section";
import { HeroSection } from "./components/hero-section";
import { HowItWorksSection } from "./components/how-it-works-section";
import { LeadCaptureSection } from "./components/lead-capture-section";
import { LiveAgendaDemoSection } from "./components/live-agenda-demo-section";
import { ServicesSection } from "./components/services-section";
import { SocialProofSection } from "./components/social-proof-section";
import { TrustIndicatorsSection } from "./components/trust-indicators-section";
import { WhatsAppFloatingButton } from "./components/whatsapp-floating-button";

export default function ServiciosDemoPage() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <HeroSection />
      <TrustIndicatorsSection />
      <ServicesSection />
      <LiveAgendaDemoSection />
      <BenefitsSection />
      <HowItWorksSection />
      <AutomationFlowSection />
      <SocialProofSection />
      <LeadCaptureSection />
      <FinalCtaSection />
      <WhatsAppFloatingButton />
    </main>
  );
}
