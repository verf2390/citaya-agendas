#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { require } from "./dte-ts-loader.mjs";

const { buildSalesBookModel, serializeSalesBookXml } = require("../../lib/dte/certification/sales-book.ts");
const { buildPurchaseBookModel, serializePurchaseBookXml } = require("../../lib/dte/certification/purchase-book.ts");

const DOCKER_IMAGE = "eclipse-temurin:21.0.5_11-jdk";
const DOCKER_DIGEST = "sha256:d59ca4960a17035592a5c928343ba56862ea6067929da4e776d7a0f4ec26aa44";
const XSD_DIR = process.env.DTE_BOOKS_XSD_DIR || "docs/dte-sii/xsd";
const expected = {
  "LibroCV_v10.xsd": "d38672ec612888b4f952264372afc836d5b905579d9735159fefe9ddacf167ce",
  "LceSiiTypes_v10.xsd": "fcccac6db4de9a74e157316d46abfa3f529086f55d45e68a9974204a25d98ca2",
  "LceCal_v10.xsd": "47378044d6dff87a9ccda7f02e338bda7665f5bcd9da1b54c79e81da5ddf5257",
  "LceCoCertif_v10.xsd": "3fc1c20b35e916a427a4800f8bbc3616489833784372f5bce9d3c121ca9fbde8",
  "xmldsignature_v10.xsd": "427e3225cd379ae92bae464b892dbf964665af92d453ac61774cffab38b95edb",
};

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixtureSales() {
  const externalData = { rutEmisorLibro: "78195645-7", rutEnvia: "12345678-5", fchResol: "2026-07-19", nroResol: 1 };
  const textCorrection = { previousBusinessActivity: "GIRO ANTERIOR FIXTURE", correctedBusinessActivity: "GIRO CORREGIDO FIXTURE" };
  const details = Object.fromEntries(["4959698-1", "4959698-2", "4959698-3", "4959698-4", "4959698-5", "4959698-6", "4959698-7", "4959698-8"].map((id, index) => [id, { folio: index + 1, recipientRut: "11111111-1", recipientName: `Cliente Fixture ${index + 1}` }]));
  const xml = serializeSalesBookXml(buildSalesBookModel({ externalData, details, textCorrection }), { includeFixtureSignature: true });
  return process.env.DTE_BOOKS_XSD_FIXTURE_MODE === "invalid-sales" ? xml.replace("<TipoOperacion>VENTA</TipoOperacion>", "<TipoOperacion>INVALIDA</TipoOperacion>") : xml;
}

function fixturePurchase() {
  const providers = Object.fromEntries(["4959700-1", "4959700-2", "4959700-3", "4959700-4", "4959700-5", "4959700-6", "4959700-7"].map((id) => [id, { rut: "11111111-1", name: `Proveedor Fixture ${id}` }]));
  const externalData = { rutEmisorLibro: "78195645-7", rutEnvia: "12345678-5", periodoTributario: "2026-07", fchResol: "2026-07-19", nroResol: 1 };
  const xml = serializePurchaseBookXml(buildPurchaseBookModel({ externalData, providers, salesBookPeriod: "2026-07" }), { includeFixtureSignature: true });
  return process.env.DTE_BOOKS_XSD_FIXTURE_MODE === "invalid-purchase" ? xml.replace("<TipoOperacion>COMPRA</TipoOperacion>", "<TipoOperacion>INVALIDA</TipoOperacion>") : xml;
}

function validateWithXmllint(label, fixtureDir) {
  const file = join(fixtureDir, `${label}.xml`);
  return spawnSync("xmllint", ["--noout", "--schema", join(XSD_DIR, "LibroCV_v10.xsd"), file], { encoding: "utf8" });
}

function writeJavaValidator(dir) {
  const source = `
import java.io.File;
import javax.xml.XMLConstants;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;
import org.xml.sax.SAXParseException;

public class ValidateLibroCv {
  public static void main(String[] args) throws Exception {
    if (args.length != 3) throw new IllegalArgumentException("usage: schema sales purchase");
    SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
    Schema schema = factory.newSchema(new File(args[0]));
    validate(schema, args[1], "salesBook");
    validate(schema, args[2], "purchaseBook");
  }
  private static void validate(Schema schema, String xmlPath, String label) throws Exception {
    try {
      Validator validator = schema.newValidator();
      validator.validate(new StreamSource(new File(xmlPath)));
      System.out.println(label + "=valid");
    } catch (SAXParseException e) {
      System.out.println(label + "=invalid");
      System.out.println(label + ".path=" + xmlPath);
      System.out.println(label + ".line=" + e.getLineNumber());
      System.out.println(label + ".column=" + e.getColumnNumber());
      System.out.println(label + ".message=" + e.getMessage());
      throw e;
    }
  }
}
`;
  writeFileSync(join(dir, "ValidateLibroCv.java"), source, "utf8");
}

function validateWithDocker(xsdDir, fixtureDir) {
  if (process.env.DTE_BOOKS_XSD_VALIDATOR === "none") return { status: 1, stdout: "compatibleValidator=unavailable\n", stderr: "forced unavailable" };
  const validatorDir = mkdtempSync(join(tmpdir(), "citaya-book-validator-"));
  writeJavaValidator(validatorDir);
  const command = [
    "run", "--rm", "--network", "none",
    "-v", `${resolve(xsdDir)}:/xsd:ro`,
    "-v", `${resolve(fixtureDir)}:/xml:ro`,
    "-v", `${resolve(validatorDir)}:/validator:ro`,
    DOCKER_IMAGE,
    "sh", "-lc",
    "javac /validator/ValidateLibroCv.java -d /tmp && java -cp /tmp ValidateLibroCv /xsd/LibroCV_v10.xsd /xml/sales.xml /xml/purchase.xml",
  ];
  return spawnSync("docker", command, { encoding: "utf8" });
}

let ok = true;
const absoluteXsdDir = resolve(XSD_DIR);
for (const [file, hash] of Object.entries(expected)) {
  const path = join(absoluteXsdDir, file);
  if (!existsSync(path)) {
    console.log(`schemaIntegrity=failed`);
    console.log(`missing=${file}`);
    process.exit(1);
  }
  if (sha256(path) !== hash) {
    console.log("schemaIntegrity=failed");
    console.log(`checksumMismatch=${file}`);
    process.exit(1);
  }
}
console.log("schemaIntegrity=ok");

const fixtureDir = mkdtempSync(join(tmpdir(), "citaya-book-xml-"));
const externalSalesPath = process.env.DTE_BOOKS_XSD_SALES_PATH;
const externalPurchasePath = process.env.DTE_BOOKS_XSD_PURCHASE_PATH;
if (Boolean(externalSalesPath) !== Boolean(externalPurchasePath)) {
  console.log("schemaCompile=failed");
  console.log("externalBooks=both_paths_required");
  process.exit(1);
}
if (externalSalesPath && externalPurchasePath) {
  copyFileSync(resolve(externalSalesPath), join(fixtureDir, "sales.xml"));
  copyFileSync(resolve(externalPurchasePath), join(fixtureDir, "purchase.xml"));
} else {
  writeFileSync(join(fixtureDir, "sales.xml"), fixtureSales(), "utf8");
  writeFileSync(join(fixtureDir, "purchase.xml"), fixturePurchase(), "utf8");
}

const xmllint = validateWithXmllint("sales", fixtureDir);
if (xmllint.status !== 0 && /maxInclusive.*999999999999999999999999999999\.9999|WXS schema .* failed to compile/s.test(xmllint.stderr)) {
  console.log("xmllint=unsupported_official_decimal_facet");
} else if (xmllint.status === 0) {
  console.log("xmllint=unexpected_success");
} else {
  console.log("xmllint=failed_unexpected");
  console.log(xmllint.stderr.trim());
  process.exit(1);
}

console.log(`compatibleValidator=docker:${DOCKER_IMAGE}@${DOCKER_DIGEST}`);
const docker = validateWithDocker(absoluteXsdDir, fixtureDir);
if (docker.status !== 0) {
  const combined = `${docker.stdout}\n${docker.stderr}`.trim();
  if (/compatibleValidator=unavailable/.test(combined) || /Cannot connect to the Docker daemon|command not found|No such image|pull access denied/i.test(combined)) {
    console.log("schemaCompile=failed");
    console.log("compatibleValidator=unavailable");
  } else {
    console.log("schemaCompile=failed");
    console.log(combined);
  }
  process.exit(1);
}
console.log("schemaCompile=ok");
process.stdout.write(docker.stdout.replace(/schemaCompile=ok\n?/g, ""));
process.exit(ok ? 0 : 1);
