import { AutomationFlowSection } from "../components/automation-flow-section";
import { HowItWorksSection } from "../components/how-it-works-section";
import { LiveAgendaDemoSection } from "../components/live-agenda-demo-section";
import { SocialProofSection } from "../components/social-proof-section";

export default function ServiciosDemoVisualPage() {
  return (
    <main>
      <LiveAgendaDemoSection />
      <HowItWorksSection />
      <AutomationFlowSection />
      <SocialProofSection />
    </main>
  );
}
