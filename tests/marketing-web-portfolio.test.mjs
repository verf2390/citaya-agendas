import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalog = readFileSync("lib/commercial/web-service-prices.ts", "utf8");
const portfolio = readFileSync("app/(marketing)/components/home/web-portfolio-section.tsx", "utf8");
const servicesPage = readFileSync("app/servicios/page.tsx", "utf8");

test("CIT-134: approved net web service prices remain exact", () => {
  const approved = {
    presencia: 199990,
    negocios: 449990,
    premiumFrom: 799990,
    customSoftwareFrom: 1490000,
    audit: 99990,
    optimizationFrom: 149990,
    maintenanceMonthlyFrom: 34990,
  };
  for (const [key, amount] of Object.entries(approved)) {
    assert.match(catalog, new RegExp(`\\b${key}: ${amount}\\b`));
    assert.match(portfolio, new RegExp(`WEB_SERVICE_PRICES_CLP\\.${key}\\b`));
  }
  assert.match(catalog, /NETOS en CLP/);
});

test("CIT-134: catalogue distinguishes monthly maintenance and from-price offers", () => {
  assert.match(portfolio, /frequency: "month"/);
  assert.match(portfolio, /priceMode: "from"/);
  assert.match(portfolio, /\+ IVA/);
  assert.match(portfolio, /Auditoría web/);
  assert.match(portfolio, /Optimización técnica/);
  assert.match(portfolio, /Mantención web/);
});

test("CIT-134: offers declare exclusions and channel for real quotations", () => {
  assert.match(portfolio, /dominio, hosting/);
  assert.match(portfolio, /CITAYA Agendas, inteligencia artificial y/);
  assert.match(portfolio, /garantiza resultados de ventas/);
  assert.match(portfolio, /Hasta 2 rondas de correcciones/);
  assert.match(portfolio, /Hasta 3 rondas de correcciones/);
  assert.doesNotMatch(portfolio, /Hasta 1 ronda de correcciones|Hasta 2 rondas de revisión/);
  assert.doesNotMatch(portfolio, /una ronda de revisión|Hasta 2 rondas de revisión/);
  assert.match(portfolio, /href=\{whatsappHref\}/);
  assert.match(portfolio, /href="\/planes"/);
  assert.match(servicesPage, /<WebPortfolioSection \/>/);
});
