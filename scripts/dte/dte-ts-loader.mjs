import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = (module, filename) => {
    const source = readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.Node16,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.Node16,
      },
      fileName: filename,
    });
    module._compile(output.outputText, filename);
  };
}

export { require };
