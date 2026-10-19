import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/empresa/page.tsx", "utf8");
const navigation = readFileSync("app/(marketing)/components/home/marketing-header.tsx", "utf8");

test("company page identifies service provider and commercial offer", () => {
  assert.match(page, /R&amp;G SpA/);
  assert.match(page, /La Serena, Coquimbo/);
  assert.match(page, /mediante cotización/);
  assert.match(page, /WhatsAppFloatingButton/);
  assert.match(page, /href="\/demos"/);
});

test("company page does not invent public-sector endorsements or case-study metrics", () => {
  assert.doesNotMatch(page, /aliado de Sercotec|proveedor oficial de Sercotec|convenio vigente|clientes satisfechos|resultados garantizados/i);
  assert.match(page, /Las demostraciones no representan resultados medidos de clientes/);
});

test("company page is accessible from the marketing navigation", () => {
  assert.match(navigation, /href: "\/empresa", label: "Empresa"/);
});
