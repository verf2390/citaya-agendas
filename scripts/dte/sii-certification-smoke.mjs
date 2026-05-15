#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });

  module._compile(output.outputText, filename);
};

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const args = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith("--track-id=")));
const trackIdArg = process.argv.find((arg) => arg.startsWith("--track-id="));
const trackId = trackIdArg?.split("=")[1]?.trim() ?? "";
const submit = args.has("--submit");
const statusOnly = args.has("--status-only");
const dryRun = args.has("--dry-run") || (!submit && !statusOnly);

const {
  getSiiCertificationConfigFromEnv,
  prepareCertificationAuthFlow,
  getSubmissionStatus,
  submitCertificationSet,
} = require(resolve(repoRoot, "lib/dte/sii/sii-certification-client.ts"));
const { validateDteConfig } = require(resolve(
  repoRoot,
  "lib/dte/config/validate-dte-config.ts",
));
const { SiiCertificationError } = require(resolve(
  repoRoot,
  "lib/dte/sii/sii-errors.ts",
));
const { writeSmokeTrace } = require(resolve(
  repoRoot,
  "lib/dte/persistence/dte-smoke-trace.ts",
));

function step(name, status, message) {
  return { name, status, message };
}

function print(steps) {
  console.log("Citaya SII Certification Smoke");
  console.log("");
  console.log(`mode=${dryRun ? "dry-run" : submit ? "submit" : "status-only"}`);
  console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
  console.log("");
  for (const item of steps) {
    console.log(`[${item.status}] ${item.name}: ${item.message}`);
  }
}

function configSummary(config) {
  return {
    environment: config.environment,
    hasSeedUrl: Boolean(config.seedUrl),
    hasTokenUrl: Boolean(config.tokenUrl),
    hasSubmitUrl: Boolean(config.submitUrl),
    hasStatusUrl: Boolean(config.statusUrl),
    hasCertPath: Boolean(config.certPath),
    hasPrivateKeyPath: Boolean(config.privateKeyPath),
    hasCafPath: Boolean(config.cafPath),
    hasCafPrivateKeyPath: Boolean(config.cafPrivateKeyPath),
    enableSubmit: Boolean(config.enableSubmit),
    rutEmpresaConfigured: Boolean(config.rutEmpresa),
  };
}

async function persistTrace(steps, config, options = {}) {
  const outputPath = resolve(
    repoRoot,
    "tmp/dte-certification/smoke-submission-log.json",
  );
  const summary = await writeSmokeTrace({
    repoRoot,
    outputPath,
    dryRun,
    submitBlocked: Boolean(options.submitBlocked),
    xml: options.xml ?? null,
    configSummary: configSummary(config),
    steps,
  });
  steps.push(
    step(
      "trace",
      "ready",
      `Trazabilidad no productiva guardada en ${outputPath} xml_sha256=${summary.xmlSha256 ?? "pendiente"}`,
    ),
  );
}

async function main() {
  const steps = [];
  const config = getSiiCertificationConfigFromEnv();
  const configItems = validateDteConfig({
    mode: process.env.DTE_MODE ?? "lab",
    env: process.env,
    repoRoot,
  });
  const dangerous = configItems.filter((item) => item.status === "DANGEROUS");
  if (dangerous.length > 0) {
    steps.push(
      step(
        "config",
        "blocked",
        `Configuracion peligrosa: ${dangerous.map((item) => item.key).join(", ")}`,
      ),
    );
    print(steps);
    process.exit(2);
  }

  const missingEndpoints = [
    ["DTE_SII_SEED_URL", config.seedUrl],
    ["DTE_SII_TOKEN_URL", config.tokenUrl],
    ["DTE_SII_SUBMIT_URL", config.submitUrl],
    ["DTE_SII_STATUS_URL", config.statusUrl],
  ].filter(([, value]) => !String(value).trim());
  steps.push(
    step(
      "config",
      missingEndpoints.length > 0 ? "pending_config" : "ready",
      missingEndpoints.length > 0
        ? `Faltan endpoints certification: ${missingEndpoints.map(([name]) => name).join(", ")}`
        : "Endpoints SII certification configurados.",
    ),
  );

  if (statusOnly) {
    if (!trackId) {
      steps.push(step("status", "blocked", "Falta --track-id=<id> para status-only."));
      print(steps);
      process.exit(1);
    }
    if (dryRun || !process.env.DTE_SII_TOKEN) {
      steps.push(
        step(
          "status",
          "pending_real_certification",
          "Status preparado; consulta real requiere token SII y endpoint configurado.",
        ),
      );
      await persistTrace(steps, config);
      print(steps);
      process.exit(0);
    }
    const status = await getSubmissionStatus(trackId, config, {
      token: process.env.DTE_SII_TOKEN,
    });
    steps.push(step("status", status.ok ? "ready" : "blocked", status.errors?.[0]?.message ?? status.siiStatus));
    print(steps);
    process.exit(status.ok ? 0 : 1);
  }

  const certificationXmlPath = resolve(
    repoRoot,
    "tmp/dte-certification/certification-envio-dte.xml",
  );
  if (dryRun) {
    steps.push(
      step(
        "generate-certification-xml",
        "pending_real_certification",
        "Dry-run no genera XML certification porque requiere CAF/certificado reales externos.",
      ),
    );
  } else {
    const generated = spawnSync(
      "node",
      ["scripts/dte/generate-lab-xml.mjs", "--mode=certification"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    steps.push(
      step(
        "generate-certification-xml",
        generated.status === 0 ? "ready" : "blocked",
        generated.status === 0
          ? "XML certification generado localmente."
          : (generated.stderr || generated.stdout || "Fallo generando XML certification.").trim(),
      ),
    );
    if (generated.status !== 0) {
      print(steps);
      process.exit(1);
    }
  }

  if (existsSync(certificationXmlPath)) {
    const validated = spawnSync(
      "node",
      [
        "scripts/dte/validate-xsd.mjs",
        certificationXmlPath,
        "docs/dte-sii/xsd/EnvioDTE_v10.xsd",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    steps.push(
      step(
        "validate-xsd",
        validated.status === 0 ? "ready" : "blocked",
        validated.status === 0
          ? "XML certification existente pasa XSD."
          : "XML certification no validado contra XSD.",
      ),
    );
  } else {
    steps.push(
      step(
        "validate-xsd",
        "pending_real_certification",
        "No hay XML certification real para validar en dry-run.",
      ),
    );
  }

  if (dryRun) {
    steps.push(
      step(
        "seed-token",
        config.seedUrl && config.tokenUrl ? "pending_real_certification" : "pending_config",
        "Seed/token preparados; dry-run no contacta SII ni imprime tokens.",
      ),
    );
    steps.push(
      step(
        "submit",
        "pending_real_certification",
        "Submit real bloqueado en dry-run. No se genera track_id simulado.",
      ),
    );
    const xml = existsSync(certificationXmlPath)
      ? readFileSync(certificationXmlPath, "latin1")
      : null;
    await persistTrace(steps, config, { xml });
    print(steps);
    process.exit(0);
  }

  const auth = await prepareCertificationAuthFlow(config);
  steps.push(step("seed-token", auth.token.ok ? "ready" : "blocked", auth.token.message));

  if (submit) {
    const xml = readFileSync(certificationXmlPath, "latin1");
    const result = await submitCertificationSet({
      signedEnvioDteXml: xml,
      fileName: "certification-envio-dte.xml",
      config,
      token: auth.token.token,
      issuerRut: config.rutEmpresa,
      companyRut: config.rutEmpresa,
      xmlPath: certificationXmlPath,
      xsdValidated: true,
      dryRun: false,
    });
    const errorMessage = "errors" in result ? result.errors?.[0]?.message : result.message;
    steps.push(step("submit", result.ok ? "ready" : "blocked", errorMessage ?? "Submit finalizado."));
    if (!result.ok) {
      await persistTrace(steps, config, { xml, submitBlocked: true });
    }
    print(steps);
    process.exit(result.ok ? 0 : 1);
  }

  print(steps);
}

main().catch((error) => {
  const message =
    error instanceof SiiCertificationError || error instanceof Error
      ? error.message
      : "Smoke SII certification fallo";
  print([step("fatal", "blocked", message)]);
  process.exit(1);
});
