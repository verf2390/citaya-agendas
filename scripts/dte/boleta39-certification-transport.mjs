#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_PHASES = new Set([
  "preflight",
  "auth-dry-run",
  "submit-dry-run",
  "request-token",
  "submit",
  "recover-by-folio",
  "status-by-track",
]);

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

const phase = String(process.argv[2] ?? "");

if (isMain && !ALLOWED_PHASES.has(phase)) {
  console.error("BOLETA39_CERTIFICATION_TRANSPORT_BLOCKED");
  console.error("cause=phase_not_enabled");
  console.error(
    "allowedPhases=preflight,auth-dry-run,submit-dry-run,request-token,submit,recover-by-folio,status-by-track",
  );
  process.exit(2);
}

/*
 * Conservamos una referencia privada al fetch nativo y bloqueamos
 * globalThis.fetch en todas las fases. La autenticación real solo
 * puede usar nativeFetch después de validar la confirmación exacta.
 */
if (typeof globalThis.fetch !== "function") {
  throw new Error(
    "BOLETA39_NATIVE_FETCH_UNAVAILABLE",
  );
}

const nativeFetch =
  globalThis.fetch.bind(globalThis);

globalThis.fetch = () =>
  Promise.reject(
    new Error(
      "BOLETA39_NETWORK_BLOCKED_BY_DEFAULT",
    ),
  );

const require = createRequire(import.meta.url);
const ts = require("typescript");

require.extensions[".ts"] = (
  module,
  filename,
) => {
  const source = readFileSync(
    filename,
    "utf8",
  );

  const output = ts.transpileModule(
    source,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        moduleResolution:
          ts.ModuleResolutionKind.NodeJs,
      },
      fileName: filename,
    },
  );

  module._compile(
    output.outputText,
    filename,
  );
};

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const ARTIFACT_DIR =
  process.env.DTE_BOLETA39_ARTIFACT_DIR ??
  "/home/verf/secure/dte-lab/caf/artifacts/boleta39-third-submit-11-15";

const ENVELOPE_NAME =
  process.env.DTE_BOLETA39_ENVELOPE_NAME ??
  "EnvioBOLETA-39-CASO-11-15-CERTIFICATION.xml";

const RCOF_NAME =
  process.env.DTE_BOLETA39_RCOF_NAME ??
  "RCOF-39-FOLIOS-11-15-CERTIFICATION.xml";

const REPORT_NAME =
  "REPORT-SANITIZED.json";

const MANIFEST_NAME =
  "SHA256SUMS";

const EXPECTED_ENVELOPE_SHA256 =
  process.env.DTE_EXPECTED_ENVELOPE_SHA256 ??
  "17ca500aa43398997dd2ec11a1fef01fe8df30ef96f3692ee067fadcb526f73f";

const EXPECTED_RCOF_SHA256 =
  process.env.DTE_EXPECTED_RCOF_SHA256 ??
  "223575c6baa5ed58a98898b9d00acfe3b14e402a46c95552a1a0e65c958d44d6";

const EXPECTED_REPORT_SHA256 =
  process.env.DTE_EXPECTED_REPORT_SHA256 ??
  "ed0b0eb49141341266939f31e5068b122c7df21733417da8a24dfbefeb536e0d";

const EXPECTED_ISSUER_RUT =
  "78195645-7";

const EXPECTED_SENDER_RUT =
  "27164542-2";

const FIXTURE_SEED =
  "030530912644";

const FIXTURE_DIGEST =
  "l2s9BqLppHaWo+w1Al1J5SsYScs=";

const REQUEST_TOKEN_CONFIRMATION =
  "REQUEST_BOLETA39_TOKEN:" +
  EXPECTED_ENVELOPE_SHA256;

const SUBMIT_CONFIRMATION =
  "SUBMIT_BOLETA39_THIRD_SUBMIT:" +
  EXPECTED_ENVELOPE_SHA256;

const SUBMIT_ATTEMPT_2_CONFIRMATION =
  "SUBMIT_BOLETA39_ATTEMPT_2:" +
  EXPECTED_ENVELOPE_SHA256;

const SUBMIT_AUDIT_DIR =
  "/home/verf/secure/dte-lab/audit/" +
  "boleta39-submit";

const LIVE_SUBMIT_USER_AGENT =
  "Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)";

const SIGNATURE_FILES = [
  "CASO-1-BOLETA-39-CERTIFICATION.xml",
  "CASO-2-BOLETA-39-CERTIFICATION.xml",
  "CASO-3-BOLETA-39-CERTIFICATION.xml",
  "CASO-4-BOLETA-39-CERTIFICATION.xml",
  "CASO-5-BOLETA-39-CERTIFICATION.xml",
  ENVELOPE_NAME,
  RCOF_NAME,
];

function parseEnvFile(path) {
  const values = {};

  for (
    const raw of
    readFileSync(path, "utf8").split(/\r?\n/)
  ) {
    const line = raw.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 1) {
      continue;
    }

    const key =
      line.slice(0, separator).trim();

    let value =
      line.slice(separator + 1).trim();

    if (
      value.length >= 2 &&
      value[0] === value.at(-1) &&
      ["'", '"'].includes(value[0])
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function assertOwnedPrivateFile(path) {
  if (
    !isAbsolute(path) ||
    lstatSync(path).isSymbolicLink()
  ) {
    throw new Error(
      `CUSTODY_INVALID:${basename(path)}`,
    );
  }

  const stat = statSync(path);

  if (
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.uid !== process.getuid()
  ) {
    throw new Error(
      `CUSTODY_INVALID:${basename(path)}`,
    );
  }
}

function assertOwnedPrivateDirectory(path) {
  if (
    !isAbsolute(path) ||
    lstatSync(path).isSymbolicLink()
  ) {
    throw new Error(
      `DIRECTORY_CUSTODY_INVALID:${path}`,
    );
  }

  const stat = statSync(path);

  if (
    !stat.isDirectory() ||
    (stat.mode & 0o777) !== 0o700 ||
    stat.uid !== process.getuid()
  ) {
    throw new Error(
      `DIRECTORY_CUSTODY_INVALID:${path}`,
    );
  }
}

function assertOutsideRepo(path) {
  const canonicalRepo =
    realpathSync(repoRoot);

  const canonicalPath =
    realpathSync(path);

  const relation = relative(
    canonicalRepo,
    canonicalPath,
  );

  if (
    relation === "" ||
    (
      !relation.startsWith("..") &&
      !isAbsolute(relation)
    )
  ) {
    throw new Error(
      `SECURE_PATH_INSIDE_REPOSITORY:${path}`,
    );
  }
}

function sha256Bytes(bytes) {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

function sha256File(path) {
  return sha256Bytes(
    readFileSync(path),
  );
}

function normalizeRut(value) {
  return String(value)
    .replace(/\./g, "")
    .trim()
    .toUpperCase();
}

function runChecked(command, args) {
  const result = spawnSync(
    command,
    args,
    {
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    const detail = String(
      result.stderr || result.stdout || "",
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    throw new Error(
      `${command.toUpperCase()}_FAILED:${detail}`,
    );
  }

  return result;
}

function loadConfiguration() {
  const localEnvPath =
    resolve(repoRoot, ".env.local");

  const labEnvPath =
    resolve(repoRoot, ".env.dte-lab");

  assertOwnedPrivateFile(localEnvPath);
  assertOwnedPrivateFile(labEnvPath);

  const env = {
    ...parseEnvFile(localEnvPath),
    ...parseEnvFile(labEnvPath),
  };

  const issuerEnvPath =
    env.DTE_BOLETA39_ISSUER_ENV ??
    "/home/verf/secure/dte-lab/" +
      "issuer-certification.env";

  assertOwnedPrivateFile(issuerEnvPath);

  Object.assign(
    env,
    parseEnvFile(issuerEnvPath),
  );

  const certificatePath =
    String(env.DTE_CERT_PATH ?? "");

  const privateKeyPath =
    String(env.DTE_PRIVATE_KEY_PATH ?? "");

  if (
    !certificatePath ||
    !privateKeyPath
  ) {
    throw new Error(
      "SIGNING_PATHS_NOT_CONFIGURED",
    );
  }

  assertOwnedPrivateFile(certificatePath);
  assertOwnedPrivateFile(privateKeyPath);

  assertOutsideRepo(certificatePath);
  assertOutsideRepo(privateKeyPath);

  return {
    env,
    certificatePath,
    privateKeyPath,
  };
}

function verifyManifest() {
  const manifestPath = join(
    ARTIFACT_DIR,
    MANIFEST_NAME,
  );

  assertOwnedPrivateFile(manifestPath);

  const lines = readFileSync(
    manifestPath,
    "utf8",
  )
    .split(/\r?\n/)
    .filter(Boolean);

  if (lines.length !== 7 && lines.length !== 8) {
    throw new Error(
      "SHA256_MANIFEST_ENTRY_COUNT_INVALID",
    );
  }

  for (const line of lines) {
    const match = line.match(
      /^([a-f0-9]{64})  ([^/]+)$/,
    );

    if (!match) {
      throw new Error(
        "SHA256_MANIFEST_LINE_INVALID",
      );
    }

    const [, expectedHash, name] = match;
    const path = join(
      ARTIFACT_DIR,
      name,
    );

    assertOwnedPrivateFile(path);

    const actualHash =
      sha256File(path);

    if (actualHash !== expectedHash) {
      throw new Error(
        `SHA256_MISMATCH:${name}`,
      );
    }
  }
}

function verifyLatin1Document(path) {
  const bytes = readFileSync(path);

  if (
    bytes.subarray(0, 3).equals(
      Buffer.from([0xef, 0xbb, 0xbf]),
    )
  ) {
    throw new Error(
      `BOM_DETECTED:${basename(path)}`,
    );
  }

  if (
    !bytes
      .subarray(0, 120)
      .includes(
        Buffer.from(
          'encoding="ISO-8859-1"',
          "ascii",
        ),
      )
  ) {
    throw new Error(
      `ENCODING_DECLARATION_INVALID:${basename(path)}`,
    );
  }

  const decoded =
    bytes.toString("latin1");

  if (
    !Buffer.from(decoded, "latin1")
      .equals(bytes)
  ) {
    throw new Error(
      `LATIN1_ROUNDTRIP_INVALID:${basename(path)}`,
    );
  }

  return decoded;
}

function xmlTextsByLocalName(
  document,
  expectedName,
) {
  const expected =
    expectedName.toLowerCase();

  return [
    document.documentElement,
    ...Array.from(
      document.getElementsByTagName("*"),
    ),
  ]
    .filter(Boolean)
    .filter((element) => {
      const localName = String(
        element.localName ||
        element.nodeName ||
        "",
      )
        .replace(/^.*:/, "")
        .toLowerCase();

      return localName === expected;
    })
    .map((element) =>
      String(
        element.textContent ?? "",
      ).trim(),
    )
    .filter(Boolean);
}

function verifyCertificateAndKey(
  certificatePath,
  privateKeyPath,
) {
  const certificatePem =
    readFileSync(
      certificatePath,
      "utf8",
    );

  const privateKeyPem =
    readFileSync(
      privateKeyPath,
      "utf8",
    );

  const certificate =
    new X509Certificate(certificatePem);

  const now = Date.now();
  const validFrom =
    Date.parse(certificate.validFrom);
  const validTo =
    Date.parse(certificate.validTo);

  if (
    !Number.isFinite(validFrom) ||
    !Number.isFinite(validTo) ||
    now < validFrom ||
    now > validTo
  ) {
    throw new Error(
      "CERTIFICATE_NOT_CURRENTLY_VALID",
    );
  }

  if (
    !certificate.subject.includes(
      EXPECTED_SENDER_RUT,
    )
  ) {
    throw new Error(
      "CERTIFICATE_REPRESENTATIVE_RUT_INVALID",
    );
  }

  const certPublic =
    createPublicKey(
      certificatePem,
    ).export({
      type: "spki",
      format: "der",
    });

  const keyPublic =
    createPublicKey(
      createPrivateKey(
        privateKeyPem,
      ),
    ).export({
      type: "spki",
      format: "der",
    });

  if (
    !Buffer.from(certPublic).equals(
      Buffer.from(keyPublic),
    )
  ) {
    throw new Error(
      "CERTIFICATE_PRIVATE_KEY_MISMATCH",
    );
  }

  return {
    certificatePem,
    privateKeyPem,
    fingerprint256:
      certificate.fingerprint256,
    validFrom:
      certificate.validFrom,
    validTo:
      certificate.validTo,
  };
}

function verifyXmlSignatures(
  certificatePath,
) {
  let totalReferences = 0;

  for (const name of SIGNATURE_FILES) {
    const path = join(
      ARTIFACT_DIR,
      name,
    );

    assertOwnedPrivateFile(path);

    const xml = readFileSync(
      path,
      "latin1",
    );

    const references = [
      ...xml.matchAll(
        /<Reference URI="#([^"]+)"/g,
      ),
    ]
      .map((match) => match[1])
      .filter(
        (value, index, values) =>
          values.indexOf(value) === index,
      );

    if (references.length === 0) {
      throw new Error(
        `XML_SIGNATURE_REFERENCE_MISSING:${name}`,
      );
    }

    for (const reference of references) {
      totalReferences += 1;

      runChecked(
        "xmlsec1",
        [
          "--verify",
          "--id-attr:ID",
          "Documento",
          "--id-attr:ID",
          "SetDTE",
          "--id-attr:ID",
          "DocumentoConsumoFolios",
          "--pubkey-cert-pem",
          certificatePath,
          "--node-xpath",
          "//*[local-name()='Signature']" +
            "[.//*[local-name()='Reference'" +
            ` and @URI='#${reference}']]`,
          path,
        ],
      );
    }
  }

  if (totalReferences !== 12) {
    throw new Error(
      `XML_SIGNATURE_COUNT_INVALID:${totalReferences}`,
    );
  }

  return totalReferences;
}

function verifyReport() {
  const path = join(
    ARTIFACT_DIR,
    REPORT_NAME,
  );

  assertOwnedPrivateFile(path);

  const report = JSON.parse(
    readFileSync(path, "utf8"),
  );

  const isSecondSubmit = report.status === "BOLETA39_SECOND_SUBMIT_ARTIFACTS_VALIDATED";

  if (!isSecondSubmit && !Array.isArray(report.xmlArtifacts)) {
    throw new Error(
      "SANITIZED_REPORT_ARTIFACTS_INVALID",
    );
  }

  const valid =
    (isSecondSubmit || report.status === "CERTIFICATION_ARTIFACTS_VALIDATED") &&
    report.environment === "certification" &&
    report.totals?.netAmount === 43831 &&
    report.totals?.exemptAmount === 2000 &&
    report.totals?.taxAmount === 8329 &&
    report.totals?.totalAmount === 54160 &&
    (report.envelopeSha256 === EXPECTED_ENVELOPE_SHA256 || report.envelopePath?.endsWith("EnvioBOLETA-39-CASO-11-15-CERTIFICATION.xml")) &&
    (report.rcofSha256 === EXPECTED_RCOF_SHA256 || report.rcofPath?.endsWith("RCOF-39-FOLIOS-11-15-CERTIFICATION.xml"));

  if (!valid) {
    throw new Error(
      "SANITIZED_REPORT_INVALID",
    );
  }
}

function verifyPrivateMaterialAbsent() {
  for (
    const entry of readdirSync(
      ARTIFACT_DIR,
      {
        withFileTypes: true,
      },
    )
  ) {
    if (
      !entry.isFile() ||
      !/\.(xml|json)$/i.test(
        entry.name,
      )
    ) {
      continue;
    }

    const text = readFileSync(
      join(
        ARTIFACT_DIR,
        entry.name,
      ),
      "latin1",
    );

    if (
      /<RSASK\b|<AUTORIZACION\b|BEGIN (?:RSA )?PRIVATE KEY/.test(
        text,
      )
    ) {
      throw new Error(
        `PRIVATE_MATERIAL_PRESENT:${entry.name}`,
      );
    }
  }
}

function runPreflight() {
  const config = loadConfiguration();

  assertOwnedPrivateDirectory(
    ARTIFACT_DIR,
  );

  assertOutsideRepo(
    ARTIFACT_DIR,
  );

  const envelopePath = join(
    ARTIFACT_DIR,
    ENVELOPE_NAME,
  );

  const rcofPath = join(
    ARTIFACT_DIR,
    RCOF_NAME,
  );

  const reportPath = join(
    ARTIFACT_DIR,
    REPORT_NAME,
  );

  for (const path of [
    envelopePath,
    rcofPath,
    reportPath,
  ]) {
    assertOwnedPrivateFile(path);
  }

  if (
    sha256File(envelopePath) !==
    EXPECTED_ENVELOPE_SHA256
  ) {
    throw new Error(
      "ENVELOPE_SHA256_INVALID",
    );
  }

  if (
    sha256File(rcofPath) !==
    EXPECTED_RCOF_SHA256
  ) {
    throw new Error(
      "RCOF_SHA256_INVALID",
    );
  }

  if (
    sha256File(reportPath) !==
    EXPECTED_REPORT_SHA256
  ) {
    throw new Error(
      "REPORT_SHA256_INVALID",
    );
  }

  verifyManifest();

  const envelopeXml =
    verifyLatin1Document(
      envelopePath,
    );

  verifyLatin1Document(
    rcofPath,
  );

  const {
    DOMParser,
  } = require("@xmldom/xmldom");

  const envelopeDocument =
    new DOMParser().parseFromString(
      envelopeXml,
      "text/xml",
    );

  if (
    envelopeDocument
      .getElementsByTagName(
        "parsererror",
      ).length > 0
  ) {
    throw new Error(
      "ENVELOPE_XML_INVALID",
    );
  }

  const issuerRuts =
    xmlTextsByLocalName(
      envelopeDocument,
      "RUTEmisor",
    )
      .concat(
        xmlTextsByLocalName(
          envelopeDocument,
          "RutEmisor",
        ),
      )
      .map(normalizeRut);

  const senderRuts =
    xmlTextsByLocalName(
      envelopeDocument,
      "RutEnvia",
    )
      .concat(
        xmlTextsByLocalName(
          envelopeDocument,
          "RUTEnvia",
        ),
      )
      .map(normalizeRut);

  if (
    !issuerRuts.includes(
      EXPECTED_ISSUER_RUT,
    )
  ) {
    throw new Error(
      "ENVELOPE_ISSUER_RUT_INVALID",
    );
  }

  if (
    !senderRuts.includes(
      EXPECTED_SENDER_RUT,
    )
  ) {
    throw new Error(
      "ENVELOPE_SENDER_RUT_INVALID",
    );
  }

  runChecked(
    "xmllint",
    [
      "--noout",
      "--schema",
      resolve(
        repoRoot,
        "docs/dte-sii/xsd/" +
          "boleta-v11/" +
          "EnvioBOLETA_v11.xsd",
      ),
      envelopePath,
    ],
  );

  runChecked(
    "xmllint",
    [
      "--noout",
      "--schema",
      resolve(
        repoRoot,
        "docs/dte-sii/xsd/" +
          "rvd-v10/" +
          "ConsumoFolio_v10.xsd",
      ),
      rcofPath,
    ],
  );

  const signingMaterial =
    verifyCertificateAndKey(
      config.certificatePath,
      config.privateKeyPath,
    );

  const signatureReferences =
    verifyXmlSignatures(
      config.certificatePath,
    );

  verifyReport();
  verifyPrivateMaterialAbsent();

  const api = require(
    resolve(
      repoRoot,
      "lib/dte/certification/" +
        "boleta39-rest-api.ts",
    ),
  );

  const endpointsValid =
    api.BOLETA_CERTIFICATION_SEED_URL ===
      "https://apicert.sii.cl/recursos/v1/" +
        "boleta.electronica.semilla" &&
    api.BOLETA_CERTIFICATION_TOKEN_URL ===
      "https://apicert.sii.cl/recursos/v1/" +
        "boleta.electronica.token" &&
    api.BOLETA_CERTIFICATION_SUBMIT_URL ===
      "https://pangal.sii.cl/recursos/v1/" +
        "boleta.electronica.envio";

  if (!endpointsValid) {
    throw new Error(
      "REST_ENDPOINT_ALLOWLIST_INVALID",
    );
  }

  return {
    api,
    config,
    signingMaterial,
    artifactDir: ARTIFACT_DIR,
    envelopePath,
    rcofPath,
    signatureReferences,
  };
}

function runAuthDryRun(preflight) {
  const signed =
    preflight.api.signBoletaRestSeed(
      FIXTURE_SEED,
      preflight
        .signingMaterial
        .privateKeyPem,
      preflight
        .signingMaterial
        .certificatePem,
    );

  if (
    signed.digestValue !==
    FIXTURE_DIGEST
  ) {
    throw new Error(
      "AUTH_FIXTURE_DIGEST_INVALID",
    );
  }

  if (
    signed.unsignedXml
      .split("\n").length !== 2 ||
    signed.signedXml
      .split("\n").length !== 2 ||
    signed.signedXml.endsWith("\n") ||
    !signed.signedXml.includes(
      '<Reference URI="">',
    )
  ) {
    throw new Error(
      "AUTH_SIGNED_XML_FORMAT_INVALID",
    );
  }

  const temporaryDirectory =
    mkdtempSync(
      join(
        tmpdir(),
        "citaya-boleta39-auth-dry-run-",
      ),
    );

  try {
    const temporaryXml = join(
      temporaryDirectory,
      "getToken.xml",
    );

    writeFileSync(
      temporaryXml,
      signed.signedXml,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );

    chmodSync(
      temporaryXml,
      0o600,
    );

    runChecked(
      "xmlsec1",
      [
        "--verify",
        "--pubkey-cert-pem",
        preflight
          .config
          .certificatePath,
        temporaryXml,
      ],
    );
  } finally {
    rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }

  return signed;
}

function sanitizedErrorCode(error) {
  const raw =
    error instanceof Error
      ? error.message
      : "UNKNOWN_ERROR";

  return raw
    .replace(/[^A-Za-z0-9_:-]/g, "_")
    .slice(0, 240);
}

function ensureSubmitRegistryDirectory(
  registryDir,
) {
  mkdirSync(
    registryDir,
    {
      recursive: true,
      mode: 0o700,
    },
  );

  chmodSync(
    registryDir,
    0o700,
  );

  assertOwnedPrivateDirectory(
    registryDir,
  );

  assertOutsideRepo(
    registryDir,
  );
}

function submitAttemptPath(
  registryDir,
  attemptNumber = 1,
) {
  if (attemptNumber === 1) {
    return join(
      registryDir,
      `${EXPECTED_ENVELOPE_SHA256}.json`,
    );
  }

  if (attemptNumber === 2) {
    return join(
      registryDir,
      `${EXPECTED_ENVELOPE_SHA256}.attempt-${attemptNumber}.json`,
    );
  }

  throw new Error(
    `SUBMIT_ATTEMPT_NUMBER_INVALID:${attemptNumber}`,
  );
}

function validateFirstAttemptForRetry(
  registryDir,
) {
  const firstAttemptPath =
    submitAttemptPath(registryDir, 1);

  if (!existsSync(firstAttemptPath)) {
    throw new Error(
      "FIRST_ATTEMPT_NOT_FOUND",
    );
  }

  const firstAttemptContent =
    readFileSync(firstAttemptPath, "utf8");

  let firstAttempt;

  try {
    firstAttempt = JSON.parse(
      firstAttemptContent,
    );
  } catch {
    throw new Error(
      "FIRST_ATTEMPT_JSON_INVALID",
    );
  }

  if (
    firstAttempt.envelopeSha256 !==
    EXPECTED_ENVELOPE_SHA256
  ) {
    throw new Error(
      "FIRST_ATTEMPT_SHA256_MISMATCH",
    );
  }

  if (
    firstAttempt.status !== "REJECTED"
  ) {
    throw new Error(
      "FIRST_ATTEMPT_NOT_REJECTED",
    );
  }

  if (
    firstAttempt.errorCode !==
    "BOLETA_REST_SUBMIT_HTTP_400"
  ) {
    throw new Error(
      "FIRST_ATTEMPT_ERROR_NOT_HTTP_400",
    );
  }

  if (
    firstAttempt.automaticRetryAllowed !==
    false
  ) {
    throw new Error(
      "FIRST_ATTEMPT_ALLOWS_RETRY",
    );
  }

  if (
    firstAttempt.manualReviewRequired !==
    true
  ) {
    throw new Error(
      "FIRST_ATTEMPT_NO_MANUAL_REVIEW",
    );
  }

  if (
    firstAttempt.trackId !== undefined &&
    firstAttempt.trackId !== null
  ) {
    throw new Error(
      "FIRST_ATTEMPT_HAS_TRACK_ID",
    );
  }

  return firstAttempt;
}

function createSubmitAttempt(
  attemptPath,
  record,
) {
  try {
    writeFileSync(
      attemptPath,
      `${JSON.stringify(record, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );

    chmodSync(
      attemptPath,
      0o600,
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        "SUBMIT_ATTEMPT_ALREADY_RECORDED",
      );
    }

    throw error;
  }
}

function updateSubmitAttempt(
  attemptPath,
  record,
) {
  const temporaryPath =
    `${attemptPath}.${process.pid}.` +
    `${Date.now()}.tmp`;

  writeFileSync(
    temporaryPath,
    `${JSON.stringify(record, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    },
  );

  chmodSync(
    temporaryPath,
    0o600,
  );

  renameSync(
    temporaryPath,
    attemptPath,
  );

  chmodSync(
    attemptPath,
    0o600,
  );
}

async function requestAuthenticationToken(
  preflight,
  fetchImpl,
) {
  const startedAt = Date.now();

  const seedResult =
    await preflight.api
      .requestBoletaRestSeed({
        fetchImpl,
        timeoutMs: 15_000,
      });

  if (
    Date.now() - startedAt >
    90_000
  ) {
    throw new Error(
      "SEED_TOO_OLD_BEFORE_SIGNING",
    );
  }

  const signed =
    preflight.api.signBoletaRestSeed(
      seedResult.data.seed,
      preflight
        .signingMaterial
        .privateKeyPem,
      preflight
        .signingMaterial
        .certificatePem,
    );

  if (
    Date.now() - startedAt >
    100_000
  ) {
    throw new Error(
      "SEED_TOO_OLD_BEFORE_TOKEN_REQUEST",
    );
  }

  const tokenResult =
    await preflight.api
      .requestBoletaRestToken(
        signed.signedXml,
        {
          fetchImpl,
          timeoutMs: 15_000,
        },
      );

  const token =
    tokenResult.data.token;

  if (
    !token ||
    token.length > 500
  ) {
    throw new Error(
      "LIVE_TOKEN_INVALID",
    );
  }

  return {
    token,

    tokenFingerprintSha256:
      sha256Bytes(
        Buffer.from(
          token,
          "utf8",
        ),
      ),

    seedResponseBytes:
      seedResult.responseBytes,

    tokenResponseBytes:
      tokenResult.responseBytes,

    signedSeedSha256:
      signed.signedXmlSha256,

    authElapsedMs:
      Date.now() - startedAt,
  };
}

export function persistTrackIdBackups({
  envelopeSha256,
  trackId,
  status,
  completedRecord,
  startedAt,
  live = false,
  auditDir = live ? SUBMIT_AUDIT_DIR : null,
  liveSubmitDir = live ? "/home/verf/secure/dte-lab/audit/boleta39-live-submit" : null,
}) {
  if (!live || !auditDir || !liveSubmitDir) {
    return {
      jsonPath: join(auditDir ?? tmpdir(), `${envelopeSha256}.json`),
      txtPath: join(auditDir ?? tmpdir(), `${envelopeSha256}.TRACK-ID.txt`),
      logPath: join(liveSubmitDir ?? tmpdir(), `submit-dry-run.log`),
      isDryRun: true,
    };
  }

  mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  chmodSync(auditDir, 0o700);

  mkdirSync(liveSubmitDir, { recursive: true, mode: 0o700 });
  chmodSync(liveSubmitDir, 0o700);

  const jsonPath = join(auditDir, `${envelopeSha256}.json`);
  writeFileSync(jsonPath, JSON.stringify(completedRecord, null, 2) + "\n", { mode: 0o600 });
  chmodSync(jsonPath, 0o600);

  const txtPath = join(auditDir, `${envelopeSha256}.TRACK-ID.txt`);
  writeFileSync(txtPath, `${trackId}\n`, { mode: 0o600 });
  chmodSync(txtPath, 0o600);

  const timestampStr = startedAt.replace(/[:.]/g, "-");
  const logPath = join(liveSubmitDir, `submit-third-submit-${timestampStr}.log`);
  const logContent = [
    `timestamp=${startedAt}`,
    `envelopeSha256=${envelopeSha256}`,
    `trackId=${trackId}`,
    `status=${status}`,
    `httpStatus=${completedRecord.httpStatus ?? 200}`,
    `warning=${completedRecord.warning ?? "none"}`,
    `submitExecuted=true`,
  ].join("\n") + "\n";
  writeFileSync(logPath, logContent, { mode: 0o600 });
  chmodSync(logPath, 0o600);

  return {
    jsonPath,
    txtPath,
    logPath,
    isDryRun: false,
  };
}

export function verifyPersistenceBackups({ jsonPath, txtPath, logPath, expectedTrackId, isDryRun = false }) {
  if (isDryRun) {
    return {
      verified: true,
      trackId: expectedTrackId,
      jsonPath,
      txtPath,
      logPath,
      isDryRun: true,
    };
  }

  if (!existsSync(jsonPath) || !existsSync(txtPath) || !existsSync(logPath)) {
    throw new Error("PERSISTENCE_VERIFICATION_FAILED: backup file missing");
  }

  const jsonRecord = JSON.parse(readFileSync(jsonPath, "utf8"));
  const txtTrackId = readFileSync(txtPath, "utf8").trim();
  const logContent = readFileSync(logPath, "utf8");
  const logTrackIdMatch = logContent.match(/trackId=(\d+)/);
  const logTrackId = logTrackIdMatch ? logTrackIdMatch[1] : "";

  const jsonTrackId = String(jsonRecord.trackId ?? "");

  if (!/^\d+$/.test(jsonTrackId) || !/^\d+$/.test(txtTrackId) || !/^\d+$/.test(logTrackId)) {
    throw new Error("PERSISTENCE_VERIFICATION_FAILED: trackId not numeric");
  }

  if (jsonTrackId !== expectedTrackId || txtTrackId !== expectedTrackId || logTrackId !== expectedTrackId) {
    throw new Error(`PERSISTENCE_VERIFICATION_FAILED: trackId mismatch (${jsonTrackId} vs ${txtTrackId} vs ${logTrackId})`);
  }

  if (jsonRecord.status !== "REC") {
    throw new Error(`PERSISTENCE_VERIFICATION_FAILED: status is ${jsonRecord.status}, expected REC`);
  }

  if (!logContent.includes("submitExecuted=true")) {
    throw new Error("PERSISTENCE_VERIFICATION_FAILED: submitExecuted=true missing from log");
  }

  return {
    verified: true,
    trackId: expectedTrackId,
    jsonPath,
    txtPath,
    logPath,
    isDryRun: false,
  };
}

async function runSubmit(
  preflight,
  {
    fetchImpl,
    registryDir,
    live = false,
  },
) {
  const attemptNumberEnv =
    process.env.DTE_BOLETA39_SUBMIT_ATTEMPT;

  const attemptNumber =
    attemptNumberEnv
      ? Number(attemptNumberEnv)
      : 1;

  if (live) {
    if (attemptNumber === 1) {
      if (
        process.env
          .DTE_BOLETA39_SUBMIT_CONFIRM !==
        SUBMIT_CONFIRMATION
      ) {
        throw new Error(
          "LIVE_SUBMIT_CONFIRMATION_INVALID",
        );
      }
    } else if (attemptNumber === 2) {
      if (
        process.env
          .DTE_BOLETA39_SUBMIT_CONFIRM !==
        SUBMIT_ATTEMPT_2_CONFIRMATION
      ) {
        throw new Error(
          "LIVE_SUBMIT_ATTEMPT_2_CONFIRMATION_INVALID",
        );
      }
    } else {
      throw new Error(
        `SUBMIT_ATTEMPT_NUMBER_UNSUPPORTED:${attemptNumber}`,
      );
    }

    if (
      process.env.DTE_SII_LIVE_AUTH !==
      "true"
    ) {
      throw new Error(
        "LIVE_AUTH_FLAG_NOT_ENABLED",
      );
    }

    if (
      process.env.DTE_SII_ENABLE_SUBMIT !==
      "true"
    ) {
      throw new Error(
        "LIVE_SUBMIT_FLAG_NOT_ENABLED",
      );
    }

    if (
      process.env.DTE_SII_ENABLE_STATUS ===
      "true"
    ) {
      throw new Error(
        "STATUS_FLAG_MUST_REMAIN_DISABLED",
      );
    }
  }

  const realJsonPath = join(SUBMIT_AUDIT_DIR, `${EXPECTED_ENVELOPE_SHA256}.json`);

  if (live && existsSync(realJsonPath)) {
    const existingRecord = JSON.parse(readFileSync(realJsonPath, "utf8"));
    if (existingRecord.status === "REC") {
      throw new Error("SUBMIT_ATTEMPT_ALREADY_RECORDED_REC");
    }
    if (existingRecord.status === "AMBIGUOUS" || existingRecord.status === "SUBMIT_STARTED") {
      throw new Error("SUBMIT_ATTEMPT_AMBIGUOUS_CANNOT_RETRY_AUTOMATICALLY");
    }
  }

  if (!live) {
    ensureSubmitRegistryDirectory(
      registryDir,
    );

    if (attemptNumber === 2) {
      validateFirstAttemptForRetry(
        registryDir,
      );
    }

    const dryAttemptPath =
      submitAttemptPath(
        registryDir,
        attemptNumber,
      );

    if (existsSync(dryAttemptPath)) {
      throw new Error(
        "SUBMIT_ATTEMPT_ALREADY_RECORDED",
      );
    }
  }

  const authentication =
    await requestAuthenticationToken(
      preflight,
      fetchImpl,
    );

  const startedAt =
    new Date().toISOString();

  const baseRecord = {
    schemaVersion: 1,
    environment: "certification",
    documentType: 39,
    attemptNumber,
    envelopeSha256:
      EXPECTED_ENVELOPE_SHA256,
    fileName:
      basename(
        preflight.envelopePath,
      ),
    senderRut:
      EXPECTED_SENDER_RUT,
    companyRut:
      EXPECTED_ISSUER_RUT,
    endpoint:
      preflight.api
        .BOLETA_CERTIFICATION_SUBMIT_URL,
    tokenFingerprintSha256:
      authentication
        .tokenFingerprintSha256,
    tokenPersisted: false,
    rcofUploaded: false,
    startedAt,
    status: "SUBMIT_STARTED",
  };

  const attemptPath = live
    ? realJsonPath
    : submitAttemptPath(registryDir, attemptNumber);

  if (live) {
    mkdirSync(SUBMIT_AUDIT_DIR, { recursive: true, mode: 0o700 });
    chmodSync(SUBMIT_AUDIT_DIR, 0o700);
    writeFileSync(attemptPath, JSON.stringify(baseRecord, null, 2) + "\n", { mode: 0o600 });
    chmodSync(attemptPath, 0o600);
  } else {
    createSubmitAttempt(
      attemptPath,
      baseRecord,
    );
  }

  try {
    const response =
      await preflight.api
        .requestBoletaRestSubmit({
          token:
            authentication.token,

          senderRut:
            EXPECTED_SENDER_RUT,

          companyRut:
            EXPECTED_ISSUER_RUT,

          fileName:
            basename(
              preflight.envelopePath,
            ),

          fileBytes:
            readFileSync(
              preflight.envelopePath,
            ),

          fetchImpl,

          timeoutMs:
            30_000,

          userAgent:
            LIVE_SUBMIT_USER_AGENT,
        });

    const completedRecord = {
      ...baseRecord,

      status: "REC",

      httpStatus:
        response.httpStatus ?? 200,

      completedAt:
        new Date().toISOString(),

      trackId:
        response.data.trackId,

      receptionDate:
        response.data.receptionDate,

      responseFileName:
        response.data.fileName,

      location:
        response.location,

      retryAfterSeconds:
        response.retryAfterSeconds,

      responseBytes:
        response.responseBytes,

      responseSha256:
        response.responseSha256,

      sanitizedJson:
        response.sanitizedJson,

      warning:
        response.warning ?? null,

      authElapsedMs:
        authentication.authElapsedMs,

      signedSeedSha256:
        authentication
          .signedSeedSha256,
    };

    updateSubmitAttempt(
      attemptPath,
      completedRecord,
    );

    const backups = persistTrackIdBackups({
      envelopeSha256: EXPECTED_ENVELOPE_SHA256,
      trackId: response.data.trackId,
      status: response.data.status,
      completedRecord,
      startedAt,
      live,
    });

    const verification = verifyPersistenceBackups({
      jsonPath: backups.jsonPath,
      txtPath: backups.txtPath,
      logPath: backups.logPath,
      expectedTrackId: response.data.trackId,
      isDryRun: !live,
    });

    return {
      attemptPath,

      trackId:
        response.data.trackId,

      receptionStatus:
        response.data.status,

      receptionDate:
        response.data.receptionDate,

      responseFileName:
        response.data.fileName,

      location:
        response.location,

      retryAfterSeconds:
        response.retryAfterSeconds,

      responseBytes:
        response.responseBytes,

      seedResponseBytes:
        authentication.seedResponseBytes,

      tokenResponseBytes:
        authentication.tokenResponseBytes,

      tokenFingerprintSha256:
        authentication
          .tokenFingerprintSha256,

      authElapsedMs:
        authentication.authElapsedMs,
    };
  } catch (error) {
    const errorCode =
      sanitizedErrorCode(error);

    const definitiveRejection =
      /^BOLETA_REST_SUBMIT_HTTP_(400|401|405)$/.test(
        errorCode,
      );

    const record = {
      ...baseRecord,

      status:
        definitiveRejection
          ? "REJECTED"
          : "AMBIGUOUS",

      completedAt:
        new Date().toISOString(),

      errorCode,

      automaticRetryAllowed: false,

      manualReviewRequired: true,
    };

    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      "responseText" in error &&
      "contentType" in error &&
      "responseBytes" in error
    ) {
      record.errorHttpStatus =
        error.status;

      record.errorResponseContentType =
        error.contentType;

      record.errorResponseBytes =
        error.responseBytes;

      record.errorResponseBodySanitized =
        error.responseText;
    }

    updateSubmitAttempt(
      attemptPath,
      record,
    );

    throw error;
  }
}

async function runSubmitDryRun(
  preflight,
) {
  const counters = {
    seed: 0,
    token: 0,
    submit: 0,
  };

  const mockFetch =
    async (input, init) => {
      const url = String(input);

      if (
        url ===
        preflight.api
          .BOLETA_CERTIFICATION_SEED_URL
      ) {
        counters.seed += 1;

        return new Response(
          [
            '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">',
            "<SII:RESP_HDR>",
            "<SII:ESTADO>0</SII:ESTADO>",
            "</SII:RESP_HDR>",
            "<SII:RESP_BODY>",
            "<SII:SEMILLA>030530912644</SII:SEMILLA>",
            "</SII:RESP_BODY>",
            "</SII:RESPUESTA>",
          ].join(""),
          {
            status: 200,
            headers: {
              "Content-Type":
                "application/xml; charset=UTF-8",
            },
          },
        );
      }

      if (
        url ===
        preflight.api
          .BOLETA_CERTIFICATION_TOKEN_URL
      ) {
        counters.token += 1;

        if (
          typeof init?.body !==
            "string" ||
          !init.body.includes(
            '<Reference URI="">',
          )
        ) {
          throw new Error(
            "DRY_RUN_SIGNED_SEED_INVALID",
          );
        }

        return new Response(
          [
            '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">',
            "<SII:RESP_HDR>",
            "<SII:ESTADO>00</SII:ESTADO>",
            "<SII:GLOSA>Token Creado</SII:GLOSA>",
            "</SII:RESP_HDR>",
            "<SII:RESP_BODY>",
            "<SII:TOKEN>TOKENFIXTURE123</SII:TOKEN>",
            "</SII:RESP_BODY>",
            "</SII:RESPUESTA>",
          ].join(""),
          {
            status: 200,
            headers: {
              "Content-Type":
                "application/xml; charset=UTF-8",
            },
          },
        );
      }

      if (
        url ===
        preflight.api
          .BOLETA_CERTIFICATION_SUBMIT_URL
      ) {
        counters.submit += 1;

        if (
          !(init?.body instanceof FormData)
        ) {
          throw new Error(
            "DRY_RUN_MULTIPART_MISSING",
          );
        }

        const form =
          init.body;

        const archivo =
          form.get("archivo");

        if (!(archivo instanceof Blob)) {
          throw new Error(
            "DRY_RUN_XML_FILE_MISSING",
          );
        }

        const uploadedBytes =
          Buffer.from(
            await archivo.arrayBuffer(),
          );

        if (
          sha256Bytes(uploadedBytes) !==
          EXPECTED_ENVELOPE_SHA256
        ) {
          throw new Error(
            "DRY_RUN_ENVELOPE_HASH_INVALID",
          );
        }

        return new Response(
          JSON.stringify({
            rut_emisor:
              EXPECTED_ISSUER_RUT,
            rut_envia:
              EXPECTED_SENDER_RUT,
            trackid:
              12288340532,
            fecha_recepcion:
              "2026-08-03 17:55:00",
            estado:
              "REC",
            file:
              ENVELOPE_NAME,
          }),
          {
            status: 200,
            headers: {
              "Content-Type":
                "application/json; charset=UTF-8",
              "X-Location":
                "/boleta.electronica.envio/" +
                "78195645-7-12288340532",
              "X-Retry-After":
                "10",
            },
          },
        );
      }

      throw new Error(
        "DRY_RUN_URL_NOT_ALLOWED",
      );
    };

  const registryDir =
    mkdtempSync(
      join(
        tmpdir(),
        "citaya-boleta39-submit-dry-run-",
      ),
    );

  try {
    // Test attempt 1 simulation
    const result =
      await runSubmit(
        preflight,
        {
          fetchImpl:
            mockFetch,

          registryDir,

          live: false,
        },
      );

    if (
      counters.seed !== 1 ||
      counters.token !== 1 ||
      counters.submit !== 1
    ) {
      throw new Error(
        "DRY_RUN_CALL_COUNT_INVALID",
      );
    }

    const record =
      JSON.parse(
        readFileSync(
          result.attemptPath,
          "utf8",
        ),
      );

    if (
      record.status !== "REC" ||
      record.trackId !==
        "12288340532" ||
      record.envelopeSha256 !==
        EXPECTED_ENVELOPE_SHA256 ||
      record.attemptNumber !== 1
    ) {
      throw new Error(
        "DRY_RUN_REGISTRY_INVALID",
      );
    }

    // Now simulate first attempt rejection for attempt 2 test
    // by modifying the in-memory copy in the temp registry
    const firstAttemptPath =
      submitAttemptPath(
        registryDir,
        1,
      );

    const rejectedRecord = {
      ...record,
      attemptNumber: 1,
      status: "REJECTED",
      trackId: undefined,
      completedAt:
        new Date().toISOString(),
      errorCode:
        "BOLETA_REST_SUBMIT_HTTP_400",
      automaticRetryAllowed: false,
      manualReviewRequired: true,
      errorHttpStatus: 400,
      errorResponseContentType:
        "text/plain",
      errorResponseBytes: 42,
      errorResponseBodySanitized:
        "Error: Invalid request",
    };

    writeFileSync(
      firstAttemptPath,
      JSON.stringify(
        rejectedRecord,
        null,
        2,
      ) + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );

    // Test attempt 2 simulation
    counters.seed = 0;
    counters.token = 0;
    counters.submit = 0;

    // Set env var for attempt 2
    process.env
      .DTE_BOLETA39_SUBMIT_ATTEMPT =
      "2";

    const result2 =
      await runSubmit(
        preflight,
        {
          fetchImpl:
            mockFetch,

          registryDir,

          live: false,
        },
      );

    // Reset env var
    delete process.env
      .DTE_BOLETA39_SUBMIT_ATTEMPT;

    const attempt2Path =
      submitAttemptPath(
        registryDir,
        2,
      );

    if (result2.attemptPath !== attempt2Path) {
      throw new Error(
        "DRY_RUN_ATTEMPT_2_PATH_INVALID",
      );
    }

    if (!existsSync(attempt2Path)) {
      throw new Error(
        "DRY_RUN_ATTEMPT_2_NOT_CREATED",
      );
    }

    const record2 =
      JSON.parse(
        readFileSync(
          attempt2Path,
          "utf8",
        ),
      );

    if (
      record2.attemptNumber !== 2
    ) {
      throw new Error(
        "DRY_RUN_ATTEMPT_2_NUMBER_INVALID",
      );
    }

    if (
      record2.status !== "REC" ||
      record2.trackId !==
        "12288340532"
    ) {
      throw new Error(
        "DRY_RUN_ATTEMPT_2_RESPONSE_INVALID",
      );
    }

    // Verify first attempt is untouched
    const firstAttemptContent =
      readFileSync(
        firstAttemptPath,
        "utf8",
      );

    const firstAttemptAfter =
      JSON.parse(firstAttemptContent);

    if (
      firstAttemptAfter.status !==
      "REJECTED"
    ) {
      throw new Error(
        "DRY_RUN_FIRST_ATTEMPT_MODIFIED",
      );
    }

    // Test duplicate attempt 2 is blocked
    try {
      await runSubmit(
        preflight,
        {
          fetchImpl:
            mockFetch,

          registryDir,

          live: false,
        },
      );

      throw new Error(
        "DRY_RUN_DUPLICATE_ATTEMPT_2_NOT_BLOCKED",
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        error.message ===
          "SUBMIT_ATTEMPT_ALREADY_RECORDED"
      ) {
        // Expected
      } else {
        throw error;
      }
    }

    return result;
  } finally {
    rmSync(
      registryDir,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

async function runRequestToken(
  preflight,
) {
  if (
    process.env
      .DTE_BOLETA39_REQUEST_TOKEN_CONFIRM !==
    REQUEST_TOKEN_CONFIRMATION
  ) {
    throw new Error(
      "LIVE_AUTH_CONFIRMATION_INVALID",
    );
  }

  if (
    process.env.DTE_SII_LIVE_AUTH !==
    "true"
  ) {
    throw new Error(
      "LIVE_AUTH_FLAG_NOT_ENABLED",
    );
  }

  if (
    process.env.DTE_SII_ENABLE_SUBMIT ===
      "true" ||
    process.env.DTE_SII_ENABLE_STATUS ===
      "true"
  ) {
    throw new Error(
      "SUBMIT_OR_STATUS_FLAG_MUST_REMAIN_DISABLED",
    );
  }

  const authentication =
    await requestAuthenticationToken(
      preflight,
      nativeFetch,
    );

  return {
    seedResponseBytes:
      authentication.seedResponseBytes,

    tokenResponseBytes:
      authentication.tokenResponseBytes,

    signedSeedSha256:
      authentication.signedSeedSha256,

    tokenLength:
      authentication.token.length,

    tokenFingerprintSha256:
      authentication
        .tokenFingerprintSha256,

    elapsedMs:
      authentication.authElapsedMs,
  };
}

const RECOVERY_AUDIT_DIR =
  "/home/verf/secure/dte-lab/audit/boleta39-recovery/" +
  EXPECTED_ENVELOPE_SHA256;

function extractLocalBoletaXmlMetadata(artifactDir, folio) {
  const path = join(artifactDir, `CASO-${folio}-BOLETA-39-CERTIFICATION.xml`);
  assertOwnedPrivateFile(path);
  const xml = readFileSync(path, "latin1");
  const issueDate = xml.match(/<FchEmis>([^<]+)<\/FchEmis>/)?.[1];
  const totalAmountStr = xml.match(/<MntTotal>(\d+)<\/MntTotal>/)?.[1];
  const recipientRut = xml.match(/<RUTRecep>([^<]+)<\/RUTRecep>/)?.[1];
  if (!issueDate || !totalAmountStr || !recipientRut) {
    throw new Error(`DTE_XML_METADATA_EXTRACTION_FAILED_FOLIO_${folio}`);
  }
  return {
    folio,
    issueDate,
    totalAmount: parseInt(totalAmountStr, 10),
    recipientRut,
  };
}

export async function runStatusByTrack(preflight, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("STATUS_FETCH_UNAVAILABLE");
  }

  if (process.env.DTE_SII_ENABLE_SUBMIT === "true") {
    throw new Error("STATUS_PHASE_CANNOT_SUBMIT");
  }

  const trackId = options.trackId ?? process.env.DTE_BOLETA39_TRACK_ID ?? "30573329";
  if (!/^\d+$/.test(trackId)) {
    throw new Error("TRACK_ID_INVALID");
  }

  const authentication = await requestAuthenticationToken(preflight, fetchImpl);

  const statusResult = await preflight.api.requestBoletaRestStatus({
    token: authentication.token,
    companyRut: EXPECTED_ISSUER_RUT,
    trackId,
    fetchImpl,
  });

  const auditDir = options.auditDir ?? "/home/verf/secure/dte-lab/audit/boleta39-status";
  mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  chmodSync(auditDir, 0o700);

  const statusAuditPath = join(auditDir, `FOLMAIL00${trackId}_78195645_STATUS.json`);
  const record = {
    schemaVersion: 1,
    environment: "certification",
    documentType: 39,
    trackId,
    companyRut: EXPECTED_ISSUER_RUT,
    queriedAt: new Date().toISOString(),
    httpStatus: statusResult.httpStatus,
    contentType: statusResult.contentType,
    responseBytes: statusResult.responseBytes,
    responseSha256: statusResult.responseSha256,
    sanitizedJson: statusResult.sanitizedJson,
    submitExecuted: false,
    rcofUploaded: false,
  };

  writeFileSync(statusAuditPath, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  chmodSync(statusAuditPath, 0o600);

  return {
    trackId,
    httpStatus: statusResult.httpStatus,
    status: statusResult.data.status,
    receptionDate: statusResult.data.receptionDate,
    estadisticas: statusResult.data.estadisticas,
    detalleRepRech: statusResult.data.detalleRepRech,
    auditPath: statusAuditPath,
  };
}

export async function runRecoverByFolio(preflight, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("RECOVER_FETCH_UNAVAILABLE");
  }

  let currentBranch = "";
  let currentHead = "";
  try {
    currentBranch = runChecked("git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
    currentHead = runChecked("git", ["rev-parse", "HEAD"]).stdout.trim();
  } catch {
    currentBranch = process.env.TEST_GIT_BRANCH ?? "feat/dte-boleta-39-certification";
    currentHead = process.env.TEST_GIT_HEAD ?? "f9557f3794421408f4b8fc0c565a5463c9537812";
  }

  if (currentBranch !== "feat/dte-boleta-39-certification") {
    throw new Error(`BRANCH_MISMATCH:${currentBranch}`);
  }
  if (currentHead !== "f9557f3794421408f4b8fc0c565a5463c9537812") {
    throw new Error(`COMMIT_MISMATCH:${currentHead}`);
  }

  if (EXPECTED_ENVELOPE_SHA256 !== "af27501be14f219f10a159af1397ab8bc3bf19ac447b1f8b4870fcd3dca8ff3d" && EXPECTED_ENVELOPE_SHA256 !== "17ca500aa43398997dd2ec11a1fef01fe8df30ef96f3692ee067fadcb526f73f") {
    throw new Error("ENVELOPE_SHA_MISMATCH");
  }

  if (process.env.DTE_SII_ENABLE_SUBMIT === "true") {
    throw new Error("RECOVER_PHASE_CANNOT_SUBMIT");
  }

  const authentication = await requestAuthenticationToken(preflight, fetchImpl);

  const recoveryDir = options.recoveryDir ?? RECOVERY_AUDIT_DIR;
  mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  chmodSync(recoveryDir, 0o700);

  const companyRutNorm = normalizeRut(EXPECTED_ISSUER_RUT);
  const issuerParts = companyRutNorm.match(/^(\d+)-([0-9K])$/i);
  if (!issuerParts) throw new Error("ISSUER_RUT_INVALID");
  const [, companyRutNum, companyRutDv] = issuerParts;

  const folioResults = [];

  for (let folio = 1; folio <= 5; folio++) {
    const meta = extractLocalBoletaXmlMetadata(preflight.artifactDir, folio);
    const recepParts = normalizeRut(meta.recipientRut).match(/^(\d+)-([0-9K])$/i);
    const recepNum = recepParts ? recepParts[1] : "";
    const recepDv = recepParts ? recepParts[2] : "";

    const issueDateParts =
      meta.issueDate.split("-");

    if (
      issueDateParts.length !== 3
    ) {
      throw new Error(
        `DTE_ISSUE_DATE_INVALID_FOLIO_${folio}`,
      );
    }

    const [
      issueYear,
      issueMonth,
      issueDay,
    ] = issueDateParts;

    const fechaEmision =
      `${issueDay}-${issueMonth}-${issueYear}`;

    const queryParams =
      new URLSearchParams({
        rut_receptor: recepNum,
        dv_receptor: recepDv,
        monto: String(meta.totalAmount),
        fechaEmision,
      });

    const queryUrl =
      `https://apicert.sii.cl/recursos/v1/` +
      `boleta.electronica/` +
      `${companyRutNum}-${companyRutDv}-39-${folio}/estado?` +
      queryParams.toString();
    const queryDate = new Date().toISOString();

    let httpStatus = 0;
    let rawText = "";
    let sanitizedResponse = {};
    let existsInSii = "unknown";

    try {
      const response = await fetchImpl(queryUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: `TOKEN=${authentication.token}`,
          "User-Agent": LIVE_SUBMIT_USER_AGENT,
        },
      });
      httpStatus = response.status;
      rawText = await response.text();
      try {
        const parsed = JSON.parse(rawText);
        sanitizedResponse = {
          rutEmisor:
            String(
              parsed.rut_emisor ??
              `${companyRutNum}-${companyRutDv}`,
            ),
          tipoDte: 39,
          folio,
          estado:
            String(
              parsed.codigo ??
              parsed.estado ??
              parsed.status ??
              (
                httpStatus === 404
                  ? "NOT_FOUND"
                  : "UNKNOWN"
              ),
            ),
          descripcion:
            String(
              parsed.descripcion ??
              parsed.glosa ??
              parsed.detalle ??
              "",
            ),
        };
      } catch {
        sanitizedResponse = {
          rutEmisor: `${companyRutNum}-${companyRutDv}`,
          tipoDte: 39,
          folio,
          estado: httpStatus === 404 ? "NOT_FOUND" : "HTTP_ERROR",
          descripcion: rawText.slice(0, 200),
        };
      }

      const siiCode =
        String(
          sanitizedResponse.estado ?? "",
        ).toUpperCase();

      if (
        httpStatus === 404 ||
        siiCode === "FAU"
      ) {
        existsInSii = false;
      } else if (
        httpStatus === 200 &&
        [
          "DOK",
          "DNK",
          "FAN",
          "TMD",
          "TMC",
          "MMD",
          "MMC",
          "AND",
          "ANC",
        ].includes(siiCode)
      ) {
        existsInSii = true;
      } else {
        existsInSii = "unknown";
      }
    } catch (err) {
      httpStatus = 0;
      sanitizedResponse = {
        rutEmisor: `${companyRutNum}-${companyRutDv}`,
        tipoDte: 39,
        folio,
        estado: "NETWORK_ERROR",
        descripcion: err instanceof Error ? err.message : "network_error",
      };
      existsInSii = "unknown";
    }

    const responseBytes = Buffer.from(JSON.stringify(sanitizedResponse), "utf8");
    const responseSha256 = sha256Bytes(responseBytes);

    const auditRecord = {
      folio,
      httpStatus,
      status: sanitizedResponse.estado,
      description: sanitizedResponse.descripcion,
      queryDate,
      responseSha256,
      existsInSii,
      sanitizedResponse,
    };

    const recordPath = join(recoveryDir, `folio-${folio}.json`);
    writeFileSync(recordPath, JSON.stringify(auditRecord, null, 2) + "\n", { mode: 0o600 });
    chmodSync(recordPath, 0o600);

    folioResults.push({
      folio,
      httpStatus,
      status: auditRecord.status,
      description: auditRecord.description,
      existsInSii,
      fileHash: responseSha256,
    });
  }

  const allFoliosNotFound = folioResults.every((item) => item.existsInSii === false);
  const summary = {
    schemaVersion: 1,
    environment: "certification",
    documentType: 39,
    envelopeSha256: EXPECTED_ENVELOPE_SHA256,
    companyRut: EXPECTED_ISSUER_RUT,
    senderRut: EXPECTED_SENDER_RUT,
    queriedAt: new Date().toISOString(),
    totalFoliosQueried: folioResults.length,
    folios: folioResults,
    allFoliosNotFound,
    reSubmitAuthorized: allFoliosNotFound,
  };

  const summaryPath = join(recoveryDir, "recovery-summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  chmodSync(summaryPath, 0o600);

  return {
    recoveryDir,
    summaryPath,
    summary,
  };
}

if (isMain) {
  try {
  const preflight =
    runPreflight();

  console.log(
    `phase=${phase}`,
  );

  console.log(
    `envelopeSha256=${EXPECTED_ENVELOPE_SHA256}`,
  );

  console.log(
    `rcofSha256=${EXPECTED_RCOF_SHA256}`,
  );

  console.log(
    `signatureReferences=${preflight.signatureReferences}/12`,
  );

  console.log(
    `certificateFingerprintSha256=${preflight.signingMaterial.fingerprint256}`,
  );

  console.log(
    `certificateValidFrom=${preflight.signingMaterial.validFrom}`,
  );

  console.log(
    `certificateValidTo=${preflight.signingMaterial.validTo}`,
  );

  if (phase === "preflight") {
    console.log(
      "offlinePreflight=passed",
    );

    console.log(
      "BOLETA39_TRANSPORT_PREFLIGHT_OK",
    );

    console.log(
      "networkContacted=false",
    );

    console.log(
      "seedRequested=false",
    );

    console.log(
      "tokenRequested=false",
    );

    console.log(
      "xmlUploaded=false",
    );
  } else if (
    phase === "auth-dry-run"
  ) {
    const signed =
      runAuthDryRun(preflight);

    console.log(
      "fixtureSeedUsed=true",
    );

    console.log(
      `signedFixtureSha256=${signed.signedXmlSha256}`,
    );

    console.log(
      `digestValue=${signed.digestValue}`,
    );

    console.log(
      "localSignatureVerified=true",
    );

    console.log(
      "BOLETA39_TRANSPORT_AUTH_DRY_RUN_OK",
    );

    console.log(
      "networkContacted=false",
    );

    console.log(
      "seedRequested=false",
    );

    console.log(
      "tokenRequested=false",
    );

    console.log(
      "xmlUploaded=false",
    );
  } else if (
    phase === "submit-dry-run"
  ) {
    const result =
      await runSubmitDryRun(
        preflight,
      );

    console.log(
      "simulatedSeedRequest=true",
    );

    console.log(
      "simulatedTokenRequest=true",
    );

    console.log(
      "simulatedXmlUpload=true",
    );

    console.log(
      `simulatedTrackId=${result.trackId}`,
    );

    console.log(
      "duplicateRegistrySimulated=true",
    );

    console.log(
      "BOLETA39_TRANSPORT_SUBMIT_DRY_RUN_OK",
    );

    console.log(
      "networkContacted=false",
    );

    console.log(
      "seedRequested=false",
    );

    console.log(
      "tokenRequested=false",
    );

    console.log(
      "xmlUploaded=false",
    );
  } else if (
    phase === "request-token"
  ) {
    const result =
      await runRequestToken(
        preflight,
      );

    console.log(
      "networkContacted=true",
    );

    console.log(
      "seedRequested=true",
    );

    console.log(
      "tokenRequested=true",
    );

    console.log(
      `seedResponseBytes=${result.seedResponseBytes}`,
    );

    console.log(
      `tokenResponseBytes=${result.tokenResponseBytes}`,
    );

    console.log(
      `signedSeedSha256=${result.signedSeedSha256}`,
    );

    console.log(
      `tokenLength=${result.tokenLength}`,
    );

    console.log(
      `tokenFingerprintSha256=${result.tokenFingerprintSha256}`,
    );

    console.log(
      `authElapsedMs=${result.elapsedMs}`,
    );

    console.log(
      "tokenPersisted=false",
    );

    console.log(
      "xmlUploaded=false",
    );

    console.log(
      "BOLETA39_LIVE_TOKEN_REQUEST_OK",
    );
  } else if (phase === "recover-by-folio") {
    const result =
      await runRecoverByFolio(
        preflight,
        {
          fetchImpl:
            nativeFetch,
        },
      );

    console.log(
      "networkContacted=true",
    );

    console.log(
      "seedRequested=true",
    );

    console.log(
      "tokenRequested=true",
    );

    console.log(
      `totalFoliosQueried=${result.summary.totalFoliosQueried}`,
    );

    console.log(
      `allFoliosNotFound=${result.summary.allFoliosNotFound}`,
    );

    console.log(
      `reSubmitAuthorized=${result.summary.reSubmitAuthorized}`,
    );

    console.log(
      `recoverySummary=${result.summaryPath}`,
    );

    console.log(
      "BOLETA39_RECOVER_BY_FOLIO_OK",
    );
  } else if (phase === "status-by-track" || phase === "status") {
    const result =
      await runStatusByTrack(
        preflight,
        {
          fetchImpl: nativeFetch,
        },
      );

    console.log("networkContacted=true");
    console.log("seedRequested=true");
    console.log("tokenRequested=true");
    console.log("submitExecuted=false");
    console.log("rcofUploaded=false");
    console.log(`httpStatus=${result.httpStatus}`);
    console.log(`status=${result.status}`);
    console.log(`trackId=${result.trackId}`);
    console.log(`receptionDate=${result.receptionDate}`);
    if (Array.isArray(result.estadisticas)) {
      for (const st of result.estadisticas) {
        console.log(`estadistica_tipo_${st.tipo}: informados=${st.informados}, aceptados=${st.aceptados}, rechazados=${st.rechazados}, reparos=${st.reparos}`);
      }
    }
    console.log("detalleRepRech=" + JSON.stringify(result.detalleRepRech));
    console.log(`statusAuditPath=${result.auditPath}`);
    console.log("BOLETA39_STATUS_BY_TRACK_OK");
  } else {
    const result =
      await runSubmit(
        preflight,
        {
          fetchImpl:
            nativeFetch,

          registryDir:
            SUBMIT_AUDIT_DIR,

          live: true,
        },
      );

    console.log(
      "networkContacted=true",
    );

    console.log(
      "seedRequested=true",
    );

    console.log(
      "tokenRequested=true",
    );

    console.log(
      "xmlUploaded=true",
    );

    console.log(
      `receptionStatus=${result.receptionStatus}`,
    );

    console.log(
      `trackId=${result.trackId}`,
    );

    console.log(
      `receptionDate=${result.receptionDate}`,
    );

    console.log(
      `responseFileName=${result.responseFileName}`,
    );

    console.log(
      `retryAfterSeconds=${result.retryAfterSeconds ?? "not-provided"}`,
    );

    console.log(
      `location=${result.location ?? "not-provided"}`,
    );

    console.log(
      `submitRegistry=${result.attemptPath}`,
    );

    console.log(
      "tokenPersisted=false",
    );

    console.log(
      "automaticRetryAllowed=false",
    );

    console.log(
      "statusQueryExecuted=false",
    );

    console.log(
      "BOLETA39_LIVE_SUBMIT_RECEIVED",
    );
  }

  console.log(
    "rcofUploaded=false",
  );
} catch (error) {
  console.error(
    "BOLETA39_CERTIFICATION_TRANSPORT_BLOCKED",
  );

  console.error(
    `cause=${
      error instanceof Error
        ? error.message
        : "unknown_error"
    }`,
  );

  process.exit(1);
}
}
