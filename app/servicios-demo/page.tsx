import { BenefitsSection } from "./components/benefits-section";
import { FinalCtaSection } from "./components/final-cta-section";
import { HeroSection } from "./components/hero-section";
import { ServicesSection } from "./components/services-section";

export default function ServiciosDemoPage() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <HeroSection />
      <BenefitsSection />
      <ServicesSection />
      <FinalCtaSection />
    </main>
  );
}
