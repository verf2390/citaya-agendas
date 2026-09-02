import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const forbidden = /(?:from\s+|import\s*\()[\"'](?:mupdf|zxing-wasm)/;
const roots = ["app", "lib/api", "lib/supabase", "lib/supabaseAdmin.ts", "lib/supabaseClient.ts", "lib/supabaseServer.ts"];
function files(path) { const stat = statSync(path); if (stat.isFile()) return [path]; return readdirSync(path).flatMap((name) => files(join(path, name))); }
for (const root of roots) for (const file of files(root).filter((name) => /\.[cm]?[jt]sx?$/.test(name))) if (forbidden.test(readFileSync(file, "utf8"))) throw new Error("laboratory dependency crossed production import boundary");
console.log("toolingImportBoundary=valid\nmupdfDeployBundle=excluded_by_import_boundary\nlegalCompatibility=not_final");
