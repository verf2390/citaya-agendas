import { BrandHeroSection } from "./(marketing)/components/home/brand-hero-section";
import { ServicesGridSection } from "./(marketing)/components/home/services-grid-section";

export default function Home() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-900">
      <BrandHeroSection />
      <ServicesGridSection />
    </main>
  );
}
