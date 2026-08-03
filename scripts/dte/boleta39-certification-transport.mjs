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
]);

const phase = String(process.argv[2] ?? "");

if (!ALLOWED_PHASES.has(phase)) {
  console.error("BOLETA39_CERTIFICATION_TRANSPORT_BLOCKED");
  console.error("cause=phase_not_enabled");
  console.error(
    "allowedPhases=preflight,auth-dry-run,submit-dry-run,request-token,submit",
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
  "/home/verf/secure/dte-lab/caf/artifacts/" +
  "boleta39-2026-08-03";

const ENVELOPE_NAME =
  "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

const RCOF_NAME =
  "RCOF-39-FOLIOS-1-5-CERTIFICATION.xml";

const REPORT_NAME =
  "REPORT-SANITIZED.json";

const MANIFEST_NAME =
  "SHA256SUMS";

const EXPECTED_ENVELOPE_SHA256 =
  "b1be80c184dbd3caf75c1380d6719a03" +
  "c0d029ea90dd5adea2837ce3615b8079";

const EXPECTED_RCOF_SHA256 =
  "cafdc7870976778290a2ea71cdf82c3f" +
  "25403453d74b44736cc0f33ee661450e";

const EXPECTED_REPORT_SHA256 =
  "87a271384b50021b99989a9e4cb3ca9f" +
  "e5d08504a373e215f45b4a23d6d5a58b";

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
  "SUBMIT_BOLETA39:" +
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

  if (lines.length !== 8) {
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

  if (
    !Array.isArray(report.xmlArtifacts)
  ) {
    throw new Error(
      "SANITIZED_REPORT_ARTIFACTS_INVALID",
    );
  }

  const artifacts = new Map(
    report.xmlArtifacts.map(
      (item) => [
        item.name,
        item,
      ],
    ),
  );

  const envelope =
    artifacts.get(ENVELOPE_NAME);

  const rcof =
    artifacts.get(RCOF_NAME);

  const valid =
    report.status ===
      "CERTIFICATION_ARTIFACTS_VALIDATED" &&
    report.environment ===
      "certification" &&
    report.documentType === 39 &&
    report.range?.from === 1 &&
    report.range?.to === 5 &&
    Array.isArray(report.cases) &&
    report.cases.length === 5 &&
    report.totals?.netAmount ===
      43831 &&
    report.totals?.exemptAmount ===
      2000 &&
    report.totals?.taxAmount ===
      8329 &&
    report.totals?.totalAmount ===
      54160 &&
    report.xsd?.boletas ===
      "5/5" &&
    report.xsd?.envelope ===
      "valid" &&
    report.xsd?.rcof ===
      "valid" &&
    report.signatures?.tedFrmt ===
      "5/5" &&
    report.signatures?.boletas ===
      "5/5" &&
    report.signatures?.envelope ===
      "valid" &&
    report.signatures?.rcof ===
      "valid" &&
    report.siiContacted === false &&
    report.productionFoliosUsed ===
      false &&
    envelope?.sha256 ===
      EXPECTED_ENVELOPE_SHA256 &&
    rcof?.sha256 ===
      EXPECTED_RCOF_SHA256 &&
    report.xmlArtifacts.length === 7;

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
) {
  return join(
    registryDir,
    `${EXPECTED_ENVELOPE_SHA256}.json`,
  );
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

async function runSubmit(
  preflight,
  {
    fetchImpl,
    registryDir,
    live,
  },
) {
  if (live) {
    if (
      process.env
        .DTE_BOLETA39_SUBMIT_CONFIRM !==
      SUBMIT_CONFIRMATION
    ) {
      throw new Error(
        "LIVE_SUBMIT_CONFIRMATION_INVALID",
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

  ensureSubmitRegistryDirectory(
    registryDir,
  );

  const attemptPath =
    submitAttemptPath(
      registryDir,
    );

  if (existsSync(attemptPath)) {
    throw new Error(
      "SUBMIT_ATTEMPT_ALREADY_RECORDED",
    );
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

  createSubmitAttempt(
    attemptPath,
    baseRecord,
  );

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
        EXPECTED_ENVELOPE_SHA256
    ) {
      throw new Error(
        "DRY_RUN_REGISTRY_INVALID",
      );
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
