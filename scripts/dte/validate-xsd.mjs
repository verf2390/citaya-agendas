#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const [xmlPathArg, schemaPathArg] = process.argv.slice(2);
const xmlPath = xmlPathArg || process.env.DTE_CERTIFICATION_XML_PATH || "tmp/dte-certification/certification-envio-dte.xml";
const schemaPath = schemaPathArg || process.env.DTE_CERTIFICATION_XSD_PATH || "docs/dte-sii/xsd/EnvioDTE_v10.xsd";

if (!xmlPath || !schemaPath) {
  console.error("Usage: node scripts/dte/validate-xsd.mjs <xml-file> <xsd-file>");
  console.error("xsd_valid=false");
  process.exit(2);
}

if (!existsSync(xmlPath)) {
  console.error(`XML file not found: ${xmlPath}`);
  console.error("xsd_valid=false");
  process.exit(2);
}

if (!existsSync(schemaPath)) {
  console.error(`XSD file not found: ${schemaPath}`);
  console.error("xsd_valid=false");
  process.exit(2);
}

const check = spawnSync("xmllint", ["--version"], {
  encoding: "utf8",
});

if (check.error) {
  console.error(
    [
      "xmllint is required for local XSD validation.",
      "Ubuntu package: libxml2-utils",
      "Install command:",
      "  sudo apt-get update",
      "  sudo apt-get install -y libxml2-utils",
      "Or use a CI image that includes xmllint.",
    ].join("\n"),
  );
  console.error("xsd_valid=false");
  process.exit(3);
}

const result = spawnSync(
  "xmllint",
  ["--noout", "--schema", schemaPath, xmlPath],
  {
    encoding: "utf8",
    stdio: "inherit",
  },
);

if (result.status === 0) {
  console.log("xsd_valid=true");
} else {
  console.error("xsd_valid=false");
}

process.exit(result.status ?? 1);
