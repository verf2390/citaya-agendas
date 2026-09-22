import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const demoLanding = readFileSync("app/tenants/[slug]/page.tsx", "utf8");
const legacyDemoLanding = readFileSync("app/demo/[slug]/page.tsx", "utf8");
const quoteCard = readFileSync("app/tenants/[slug]/DemoQuoteCard.tsx", "utf8");

test("public demo does not present unverified active clients or testimonials", () => {
  for (const source of [demoLanding, legacyDemoLanding]) {
    assert.doesNotMatch(source, /Negocios reales ya están usando esto/);
    assert.doesNotMatch(source, /Confirmación automática después de reservar/);
  }

  for (const text of [
    "Fajas Paola — La Serena",
    "Reservé en 30 segundos. Se siente súper pro.",
    "Me llegó la confirmación y pude reagendar sin hablar con nadie.",
    "Así debería funcionar cualquier agenda online.",
  ]) {
    assert.equal(demoLanding.includes(text), false, `unexpected demo social-proof copy: ${text}`);
  }

  assert.match(
    demoLanding,
    /Contenido demostrativo, no testimonio de un cliente activo/,
  );
});

test("demo commercial price matches the current CVE implementation offer", () => {
  assert.match(quoteCard, /const IMPLEMENTATION_PRICE = 49900;/);
  assert.match(quoteCard, /<b>\$49\.900<\/b>/);
  assert.doesNotMatch(quoteCard, /<b>\$49\.000<\/b>/);
});

test("demo copy distinguishes functional reservation flow from external communications", () => {
  assert.match(demoLanding, /Confirmación de la reserva dentro del sistema/);
  assert.match(legacyDemoLanding, /Flujo funcional para probar reservas de demostración/);
  assert.doesNotMatch(legacyDemoLanding, /Sistema probado con reservas reales/);
});
