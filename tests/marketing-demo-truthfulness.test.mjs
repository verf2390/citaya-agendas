import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const demoData = readFileSync("app/(marketing)/components/home/marketing-content.ts", "utf8");
const demoShowcase = readFileSync("app/(marketing)/components/home/demos-showcase-section.tsx", "utf8");
const demoForm = readFileSync("app/servicios-demo/components/lead-capture-section.tsx", "utf8");
const demoContactPage = readFileSync("app/servicios-demo/contacto/page.tsx", "utf8");

test("marketing demos are labeled as examples, not measured client success", () => {
  assert.match(demoShowcase, /No representan casos de clientes ni resultados comerciales medidos/);
  assert.match(demoShowcase, /Demostración/);
  assert.doesNotMatch(demoShowcase, /Estos son ejemplos reales de páginas y sistemas/);
  assert.match(demoShowcase, /Situación de ejemplo/);
  assert.match(demoShowcase, /Objetivo ilustrado/);
  assert.doesNotMatch(demoData, /Más reservas y menos tiempo coordinando|Más claridad y más consultas útiles/);
});

test("simulated contact form never asserts that a real lead was received", () => {
  assert.match(demoForm, /no registra ni envía los datos/);
  assert.match(demoForm, /no hemos enviado ni almacenado tu solicitud/);
  assert.match(demoForm, /Simular envío/);
  assert.match(demoForm, /whatsappHref/);
  assert.match(demoForm, /\$14\.990 \+ IVA/);
  assert.match(demoForm, /\$30\.990 \+ IVA/);
  assert.doesNotMatch(demoForm, /Planes desde \$29\.000 mensual/);
  assert.doesNotMatch(demoForm, /Lead recibido y en proceso|Tu solicitud quedó registrada con confirmación automática|El equipo comercial la priorizará/);
  assert.match(demoContactPage, /no envía ni almacena solicitudes/);
});
