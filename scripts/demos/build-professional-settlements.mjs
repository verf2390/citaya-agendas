import { readFile, writeFile } from "node:fs/promises";
import { previewPercentageSettlement, splitSettlementAmount } from "../../lib/settlements/percentage.mjs";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Indica el archivo HTML de salida.");

const template = await readFile(new URL("professional-settlements.html", import.meta.url), "utf8");
const logo = await readFile(new URL("../../public/citaya-logo.svg", import.meta.url), "utf8");
const html = template
  .replace("{{LOGO}}", "data:image/svg+xml;base64," + Buffer.from(logo).toString("base64"))
  .replace("{{CALCULATOR}}", () => [splitSettlementAmount, previewPercentageSettlement].map((fn) => fn.toString()).join("\n\n"));
await writeFile(outputPath, html);
