#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const [xmlPath, schemaPath] = process.argv.slice(2);

if (!xmlPath || !schemaPath) {
  console.error("Usage: node scripts/dte/validate-xsd.mjs <xml-file> <xsd-file>");
  process.exit(2);
}

if (!existsSync(xmlPath)) {
  console.error(`XML file not found: ${xmlPath}`);
  process.exit(2);
}

if (!existsSync(schemaPath)) {
  console.error(`XSD file not found: ${schemaPath}`);
  process.exit(2);
}

const check = spawnSync("xmllint", ["--version"], {
  encoding: "utf8",
});

if (check.error) {
  console.error(
    "xmllint is required for local XSD validation. Install libxml2 tools or use a CI image that includes xmllint.",
  );
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

process.exit(result.status ?? 1);
