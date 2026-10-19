import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const marketingAndDemoFiles = [
  "app/inmo-demo/contacto/page.tsx",
  "app/servicios-demo/components/final-cta-section.tsx",
  "app/servicios-demo/components/whatsapp-floating-button.tsx",
  "app/(marketing)/components/home/whatsapp-floating-button.tsx",
  "app/servicios-demo/components/hero-section.tsx",
  "app/(marketing)/components/home/marketing-content.ts",
  "app/tenants/[slug]/DemoQuoteCard.tsx",
  "app/inmo-demo/propiedades/[slug]/page.tsx",
  "app/(marketing)/components/home/plans-section.tsx",
  "app/(marketing)/components/home/brand-hero-section.tsx",
];

test("public commercial CTAs link to the approved CITAYA WhatsApp number", () => {
  for (const path of marketingAndDemoFiles) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /56961425029/, `obsolete CITAYA number in ${path}`);
    assert.match(source, /56996966059/, `missing approved CITAYA number in ${path}`);
  }
});
