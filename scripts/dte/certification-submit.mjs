#!/usr/bin/env node
import { createHash } from "node:crypto";
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

process.env.DTE_MODE = process.env.DTE_MODE || "certification";
process.env.DTE_SII_ENV = process.env.DTE_SII_ENV || "certification";

const { buildDteCertificationReadiness, isPathInsideRepo } = require(resolve(
  repoRoot,
  "lib/dte/config/validate-dte-config.ts",
));
const {
  getSiiCertificationConfigFromEnv,
  prepareCertificationAuthFlow,
  getSubmissionStatus,
  submitCertificationSet,
} = require(resolve(repoRoot, "lib/dte/sii/sii-certification-client.ts"));
const { buildAuditRecord } = require(resolve(
  repoRoot,
  "lib/dte/persistence/dte-audit.ts",
));
const { redactSiiResponse } = require(resolve(
  repoRoot,
  "lib/dte/persistence/dte-redaction.ts",
));
const { buildStatusHistoryRecord } = require(resolve(
  repoRoot,
  "lib/dte/persistence/dte-status-history.ts",
));
const { buildSubmissionRecord } = require(resolve(
  repoRoot,
  "lib/dte/persistence/dte-submissions.ts",
));
const { buildSmokeDocumentIdentity, getSmokeTenantId } = require(resolve(
  repoRoot,
  "lib/dte/persistence/dte-smoke-trace.ts",
));
const { getDtePersistenceBackend, getDteRepository } = require(resolve(
  repoRoot,
  "lib/dte/persistence/get-dte-repository.ts",
));

const { createClient } = require("@supabase/supabase-js");

const REQUIRED_ENDPOINTS = [
  "DTE_SII_SEED_URL",
  "DTE_SII_TOKEN_URL",
  "DTE_SII_SUBMIT_URL",
  "DTE_SII_STATUS_URL",
];
const REQUIRED_EXTERNAL_FILES = ["DTE_CAF_PATH", "DTE_CERT_PATH", "DTE_PRIVATE_KEY_PATH"];

function envValue(name) {
  return String(process.env[name] ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeHost(value) {
  if (!value) return "absent";
  try {
    const host = new URL(value).host;
    if (host.length <= 18) return host;
    return `${host.slice(0, 6)}...${host.slice(-12)}`;
  } catch {
    return "configured_invalid_url";
  }
}

function boolLabel(value) {
  return value ? "si" : "no";
}

function pathState(name) {
  const value = envValue(name);
  const exists = Boolean(value) && existsSync(value);
  const outsideRepo = Boolean(value) && !isPathInsideRepo(value, repoRoot);
  return { configured: Boolean(value), exists, outsideRepo };
}

function step(name, status, message) {
  return { name, status, message };
}

function print(summary, steps) {
  console.log("Citaya DTE SII Certification Controlled Submit");
  console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
  console.log("track_id_simulado=NO");
  console.log("");
  for (const [key, value] of Object.entries(summary)) {
    console.log(`${key}=${value}`);
  }
  console.log("");
  for (const item of steps) {
    console.log(`[${item.status}] ${item.name}: ${item.message}`);
  }
}

function buildSafeSummary(readiness, backend) {
  const caf = pathState("DTE_CAF_PATH");
  const cert = pathState("DTE_CERT_PATH");
  const key = pathState("DTE_PRIVATE_KEY_PATH");
  return {
    tenant_id_presente: boolLabel(Boolean(envValue("DTE_SMOKE_TENANT_ID"))),
    DTE_MODE: readiness.mode,
    DTE_SII_ENV: envValue("DTE_SII_ENV") || "certification",
    DTE_PERSISTENCE_BACKEND: backend || "memory",
    supabase_url_presente: boolLabel(Boolean(envValue("NEXT_PUBLIC_SUPABASE_URL"))),
    supabase_host: safeHost(envValue("NEXT_PUBLIC_SUPABASE_URL")),
    endpoints_presentes: boolLabel(REQUIRED_ENDPOINTS.every((name) => envValue(name))),
    caf_path_configurado: boolLabel(caf.configured),
    caf_existe: boolLabel(caf.exists),
    caf_fuera_repo: boolLabel(caf.outsideRepo),
    certificado_path_configurado: boolLabel(cert.configured),
    certificado_existe: boolLabel(cert.exists),
    certificado_fuera_repo: boolLabel(cert.outsideRepo),
    private_key_path_configurado: boolLabel(key.configured),
    private_key_existe: boolLabel(key.exists),
    private_key_fuera_repo: boolLabel(key.outsideRepo),
    submit_habilitado: boolLabel(envValue("DTE_SII_ENABLE_SUBMIT") === "true"),
    production_bloqueado: boolLabel(
      readiness.status === "blocked_production" ||
        envValue("DTE_MODE") === "production" ||
        envValue("DTE_SII_ENV") === "production",
    ),
    readiness_status: readiness.status,
  };
}

function collectPreflightBlocks(readiness, backend) {
  const blocks = [];
  if (envValue("DTE_MODE") === "production") {
    blocks.push(step("production", "blocked_production", "DTE_MODE=production bloqueado."));
  }
  if (envValue("DTE_SII_ENV") === "production") {
    blocks.push(
      step("production", "blocked_production", "DTE_SII_ENV=production bloqueado."),
    );
  }
  if (envValue("DTE_SII_ENABLE_SUBMIT") !== "true") {
    blocks.push(
      step(
        "submit_flag",
        "blocked_submit",
        "Falta DTE_SII_ENABLE_SUBMIT=true; no se contacta SII.",
      ),
    );
  }
  if (!envValue("DTE_SMOKE_TENANT_ID")) {
    blocks.push(
      step("tenant", "pending_config", "Falta DTE_SMOKE_TENANT_ID con UUID tenant LAB."),
    );
  }
  if (backend !== "supabase") {
    blocks.push(
      step(
        "persistence",
        "blocked_submit",
        "Submit real requiere DTE_PERSISTENCE_BACKEND=supabase.",
      ),
    );
  }
  if (!envValue("NEXT_PUBLIC_SUPABASE_URL")) {
    blocks.push(step("supabase", "pending_config", "Falta NEXT_PUBLIC_SUPABASE_URL para LAB."));
  }
  if (!envValue("SUPABASE_SERVICE_ROLE_KEY")) {
    blocks.push(step("supabase", "pending_config", "Falta SUPABASE_SERVICE_ROLE_KEY para LAB."));
  }
  for (const name of REQUIRED_ENDPOINTS) {
    if (!envValue(name)) blocks.push(step("sii_endpoint", "pending_config", `Falta ${name}.`));
  }
  for (const name of REQUIRED_EXTERNAL_FILES) {
    const state = pathState(name);
    if (!state.configured) {
      blocks.push(step("external_file", "pending_config", `Falta ${name}.`));
    } else if (!state.exists) {
      blocks.push(step("external_file", "pending_real_certification", `${name} no existe.`));
    } else if (!state.outsideRepo) {
      blocks.push(step("external_file", "blocked_submit", `${name} apunta dentro del repo.`));
    }
  }
  if (readiness.status === "blocked_production") {
    blocks.push(step("readiness", "blocked_production", "Readiness detecto riesgo de produccion."));
  } else if (readiness.status !== "ready") {
    blocks.push(
      step(
        "readiness",
        readiness.status === "missing_external_file"
          ? "pending_real_certification"
          : "pending_config",
        `Readiness no esta ready: ${readiness.status}.`,
      ),
    );
  }
  return blocks;
}

function assertNoSensitiveOutput(text) {
  const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRole && text.includes(serviceRole)) {
    throw new Error("INTERNAL_SAFETY_ERROR: output contiene SUPABASE_SERVICE_ROLE_KEY.");
  }
}

async function assertTenantExists(tenantId) {
  const supabase = createClient(
    envValue("NEXT_PUBLIC_SUPABASE_URL"),
    envValue("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const result = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (result.error) throw new Error(`TENANT_LOOKUP_FAILED: ${result.error.message}`);
  if (!result.data) throw new Error("TENANT_NOT_FOUND_IN_SUPABASE_LAB");
}

function generateCertificationXml() {
  const generated = spawnSync(
    "node",
    ["scripts/dte/generate-lab-xml.mjs", "--mode=certification"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return {
    ok: generated.status === 0,
    stdout: generated.stdout ?? "",
    stderr: generated.stderr ?? "",
    path: resolve(repoRoot, "tmp/dte-certification/certification-envio-dte.xml"),
  };
}

function validateXsd(xmlPath) {
  const validated = spawnSync(
    "node",
    ["scripts/dte/validate-xsd.mjs", xmlPath, "docs/dte-sii/xsd/EnvioDTE_v10.xsd"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return { ok: validated.status === 0, stdout: validated.stdout, stderr: validated.stderr };
}

function hasNonCertifiableWarnings(text) {
  return /no equivale a aprobacion SII|no se marca como valida SII|XML experimental|NO PRODUCTIVO/i.test(
    text,
  );
}

async function persistBlockedTrace(repo, draft, xml, steps, reason) {
  if (xml) {
    const xmlGenerated = await repo.markXmlGenerated({
      tenantId: draft.tenantId,
      taxDocumentId: draft.id,
      xml,
      xmlStoragePath: null,
    });
    if (!xmlGenerated.ok) throw new Error(xmlGenerated.error);
  }

  const submission = buildSubmissionRecord({
    tenantId: draft.tenantId,
    taxDocumentId: draft.id,
    environment: "certification",
    submissionStatus: "blocked",
    siiStatus: "not_sent",
    requestXml: xml,
    response: { status: "pending_real_certification", reason },
  });
  const submissionResult = await repo.createSiiSubmission(submission);
  if (!submissionResult.ok) throw new Error(submissionResult.error);

  const historyResult = await repo.appendStatusHistory(
    buildStatusHistoryRecord({
      tenantId: draft.tenantId,
      taxDocumentId: draft.id,
      submissionId: submission.id,
      previousStatus: "draft",
      nextStatus: xml ? "xml_generated" : "draft",
      previousSiiStatus: "not_sent",
      nextSiiStatus: "not_sent",
      reason,
      source: "script",
    }),
  );
  if (!historyResult.ok) throw new Error(historyResult.error);

  const auditResult = await repo.appendAuditLog(
    buildAuditRecord({
      tenantId: draft.tenantId,
      taxDocumentId: draft.id,
      submissionId: submission.id,
      action: "sii_certification_submit_blocked",
      actorType: "script",
      metadata: { reason, steps },
    }),
  );
  if (!auditResult.ok) throw new Error(auditResult.error);

  return submission;
}

async function createTraceableDraft(repo, backend, tenantId) {
  const identity = buildSmokeDocumentIdentity(backend, process.env);
  const draftResult = await repo.createTaxDocumentDraft({
    tenantId,
    documentType: "factura_afecta",
    folio: identity.folio,
    emitterRut: "76.123.456-0",
    emitterName: "Empresa Demo Citaya SpA",
    receiverRut: "11.111.111-1",
    receiverName: "Cliente Demo",
    issueDate: new Date().toISOString().slice(0, 10),
    totalAmount: 11900,
    netAmount: 10000,
    taxAmount: 1900,
    exemptAmount: 0,
    paymentReference: identity.paymentReference.replace("smoke-dry-run", "certification-submit"),
  });
  if (!draftResult.ok) throw new Error(draftResult.error);
  return draftResult.record;
}

async function main() {
  const steps = [];
  const backend = getDtePersistenceBackend(process.env);
  const readiness = buildDteCertificationReadiness({
    mode: process.env.DTE_MODE ?? "certification",
    env: process.env,
    repoRoot,
  });
  const summary = buildSafeSummary(readiness, backend);
  steps.push(step("readiness", readiness.status, `status=${readiness.status}`));

  const preflightBlocks = collectPreflightBlocks(readiness, backend);
  if (preflightBlocks.length > 0) {
    steps.push(...preflightBlocks);
    assertNoSensitiveOutput(JSON.stringify({ summary, steps }));
    print(summary, steps);
    process.exit(
      preflightBlocks.some((item) => item.status === "blocked_production") ? 2 : 1,
    );
  }

  const tenantId = getSmokeTenantId(backend, process.env);
  await assertTenantExists(tenantId);
  steps.push(step("tenant", "ready", "Tenant LAB existe en Supabase."));

  const repo = getDteRepository(process.env);
  const draft = await createTraceableDraft(repo, backend, tenantId);
  steps.push(
    step(
      "tax_document",
      "ready",
      `Documento trazable creado tax_document_id=${draft.id} folio=${draft.folio}`,
    ),
  );

  const generated = generateCertificationXml();
  if (!generated.ok) {
    steps.push(
      step(
        "generate_xml",
        "pending_real_certification",
        "XML certification no generado; revisar CAF/cert/key externos.",
      ),
    );
    await persistBlockedTrace(repo, draft, null, steps, "XML certification pendiente");
    print(summary, steps);
    process.exit(1);
  }
  const xml = readFileSync(generated.path, "latin1");
  steps.push(step("generate_xml", "ready", `XML generado hash=${sha256(xml).slice(0, 16)}`));

  const xsd = validateXsd(generated.path);
  steps.push(
    step(
      "validate_xsd",
      xsd.ok ? "ready" : "blocked_submit",
      xsd.ok ? "XML pasa XSD local." : "XML no pasa XSD local; submit bloqueado.",
    ),
  );
  if (!xsd.ok) {
    await persistBlockedTrace(repo, draft, xml, steps, "XSD local fallo");
    print(summary, steps);
    process.exit(1);
  }

  if (hasNonCertifiableWarnings(`${generated.stdout}\n${generated.stderr}`)) {
    steps.push(
      step(
        "signing",
        "pending_real_certification",
        "Firma/XML aun no se marca como valida SII; no se contacta SII.",
      ),
    );
    const submission = await persistBlockedTrace(
      repo,
      draft,
      xml,
      steps,
      "Firma/XML certification pendiente de validacion real SII",
    );
    steps.push(
      step("trace", "ready", `Trazabilidad LAB guardada submission_id=${submission.id} track_id=null`),
    );
    print(summary, steps);
    process.exit(1);
  }

  const config = getSiiCertificationConfigFromEnv(process.env);
  const auth = await prepareCertificationAuthFlow(config);
  steps.push(step("seed", auth.seed ? "ready" : "failed", "Seed SII procesado."));
  steps.push(
    step(
      "token",
      auth.token.ok ? "ready" : "failed",
      auth.token.ok ? "Token SII obtenido; no se imprime ni persiste completo." : auth.token.message,
    ),
  );
  if (!auth.token.ok) {
    await persistBlockedTrace(repo, draft, xml, steps, "Token SII no obtenido");
    print(summary, steps);
    process.exit(1);
  }

  const submit = await submitCertificationSet({
    signedEnvioDteXml: xml,
    fileName: "certification-envio-dte.xml",
    config,
    token: auth.token.token,
    issuerRut: config.rutEmpresa,
    companyRut: config.rutEmpresa,
    xmlPath: generated.path,
    xsdValidated: true,
    dryRun: false,
  });
  const submittedAt = "submittedAt" in submit ? submit.submittedAt : new Date().toISOString();
  const trackId = "trackId" in submit ? submit.trackId ?? null : null;
  const submissionRecord = buildSubmissionRecord({
    tenantId: draft.tenantId,
    taxDocumentId: draft.id,
    environment: "certification",
    trackId,
    submissionStatus: submit.ok ? "submitted" : "failed",
    siiStatus: submit.ok ? "sent" : "failed",
    requestXml: xml,
    response: submit,
    token: auth.token.token,
    submittedAt,
  });
  const submissionResult = await repo.createSiiSubmission(submissionRecord);
  if (!submissionResult.ok) throw new Error(submissionResult.error);
  steps.push(
    step(
      "submit",
      submit.ok ? "submitted" : "failed",
      trackId
        ? `SII devolvio track_id real fingerprint=${sha256(trackId).slice(0, 12)}`
        : "SII no devolvio track_id; queda null.",
    ),
  );

  let nextSiiStatus = submissionRecord.siiStatus;
  let nextStatus = submit.ok ? "submitted" : "failed";
  if (trackId) {
    const status = await getSubmissionStatus(trackId, config, { token: auth.token.token });
    nextSiiStatus =
      status.siiStatus === "accepted"
        ? "accepted"
        : status.siiStatus === "rejected"
          ? "rejected"
          : status.siiStatus === "error"
            ? "failed"
            : "processing";
    nextStatus =
      nextSiiStatus === "accepted"
        ? "accepted"
        : nextSiiStatus === "rejected"
          ? "rejected"
          : nextSiiStatus === "failed"
            ? "failed"
            : "submitted";
    const redacted = redactSiiResponse(status);
    const update = await repo.updateSiiSubmissionStatus({
      tenantId: draft.tenantId,
      submissionId: submissionRecord.id,
      submissionStatus: nextStatus === "failed" ? "failed" : "submitted",
      siiStatus: nextSiiStatus,
      trackId,
      responseSha256: redacted.sha256,
      rawResponseRedacted: redacted,
      checkedAt: status.checkedAt,
    });
    if (!update.ok) throw new Error(update.error);
    steps.push(step("status", nextStatus, "Status SII consultado y redactado."));
  } else {
    steps.push(step("status", "pending", "Sin track_id real; no se consulta status."));
  }

  await repo.appendStatusHistory(
    buildStatusHistoryRecord({
      tenantId: draft.tenantId,
      taxDocumentId: draft.id,
      submissionId: submissionRecord.id,
      previousStatus: "xml_generated",
      nextStatus,
      previousSiiStatus: "not_sent",
      nextSiiStatus,
      reason: "Primer submit SII certification controlado",
      source: "sii",
    }),
  );
  await repo.appendAuditLog(
    buildAuditRecord({
      tenantId: draft.tenantId,
      taxDocumentId: draft.id,
      submissionId: submissionRecord.id,
      action: "sii_certification_submit_attempted",
      actorType: "script",
      metadata: { steps, trackIdPresent: Boolean(trackId) },
    }),
  );

  print(summary, steps);
  process.exit(submit.ok ? 0 : 1);
}

main().catch((error) => {
  const backend = (() => {
    try {
      return getDtePersistenceBackend(process.env);
    } catch {
      return "memory";
    }
  })();
  const readiness = buildDteCertificationReadiness({
    mode: process.env.DTE_MODE ?? "certification",
    env: process.env,
    repoRoot,
  });
  const summary = buildSafeSummary(readiness, backend);
  const message = error instanceof Error ? error.message : "certification submit failed";
  print(summary, [
    step("fatal", "failed", message.replace(envValue("SUPABASE_SERVICE_ROLE_KEY"), "[redacted]")),
  ]);
  process.exit(1);
});
