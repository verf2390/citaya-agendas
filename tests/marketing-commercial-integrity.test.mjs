import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const plans = readFileSync("app/(marketing)/components/home/plans-section.tsx", "utf8");
const hero = readFileSync("app/(marketing)/components/home/brand-hero-section.tsx", "utf8");
const commercialInfo = readFileSync("app/(marketing)/components/home/social-proof-section.tsx", "utf8");

test("marketing home does not promote the expired April 2026 offer", () => {
  assert.doesNotMatch(plans, /2026-04-30|30 de abril|Quiero esta promo|Implementación gratis por 1 mes|countdownTarget/);
  assert.match(plans, /Consultar Plan Inicio/);
  assert.match(plans, /Consultar Plan Profesional/);
  assert.match(plans, /Plan de entrada/);
});

test("marketing hero identifies illustrative data instead of asserting real results", () => {
  assert.doesNotMatch(hero, /\+18 nuevos contactos|12 reservas confirmadas|0 clientes perdidos|>En vivo</);
  assert.match(hero, /Ejemplo visual/);
  assert.match(hero, /No representa métricas de clientes reales/);
});

test("marketing home does not attribute invented testimonials to clients", () => {
  assert.doesNotMatch(commercialInfo, /const testimonials|“\{testimonial\}”|Resultados que se notan/);
  assert.match(commercialInfo, /capabilities\.map/);
  assert.match(commercialInfo, /Herramientas para ordenar tu atención/);
});
