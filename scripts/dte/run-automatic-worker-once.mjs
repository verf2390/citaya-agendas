const enabled = process.env.DTE_AUTOMATIC_WORKER_ENABLED === "true";
const productionEnabled = process.env.DTE_PRODUCTION_ENABLED === "true";
const secret = String(process.env.DTE_WORKER_SECRET ?? "");
const automaticTargetOutboxId = String(
  process.env.DTE_AUTOMATIC_TARGET_OUTBOX_ID ?? "",
).trim();
const automaticOwnedFolioResumeValue = String(
  process.env.DTE_AUTOMATIC_OWNED_FOLIO_RESUME ?? "",
).trim();
const automaticOwnedFolioResume = automaticOwnedFolioResumeValue === "true";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!enabled || !productionEnabled) {
  console.log("automaticDteWorker=disabled");
  process.exit(0);
}
if (secret.length < 32) {
  console.error("automaticDteWorker=misconfigured");
  process.exit(1);
}
if (
  automaticOwnedFolioResumeValue &&
  !["true", "false"].includes(automaticOwnedFolioResumeValue)
) {
  console.error("automaticDteWorker=resume_invalid");
  process.exit(1);
}
if (automaticTargetOutboxId && !uuid.test(automaticTargetOutboxId)) {
  console.error("automaticDteWorker=target_invalid");
  process.exit(1);
}
if (automaticOwnedFolioResume && !automaticTargetOutboxId) {
  console.error("automaticDteWorker=resume_target_required");
  process.exit(1);
}

try {
  const response = await fetch("http://127.0.0.1:3000/api/internal/dte-worker", {
    method: "POST",
    headers: {
      "x-citaya-worker-secret": secret,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      mode: "automatic",
      ...(automaticTargetOutboxId ? { automaticTargetOutboxId } : {}),
      ...(automaticOwnedFolioResume ? { automaticOwnedFolioResume: true } : {}),
    }),
    signal: AbortSignal.timeout(12 * 60 * 1000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    console.error(`automaticDteWorker=http_${response.status}`);
    process.exit(1);
  }
  const result = payload.result ?? {};
  const statusCandidate = String(result.status ?? "");
  const status = /^[A-Z][A-Z0-9_]{1,39}$/.test(statusCandidate)
    ? statusCandidate
    : null;
  const attemptsCandidate = Number(result.networkAttempts);
  const networkAttempts = Number.isSafeInteger(attemptsCandidate) &&
    attemptsCandidate >= 0 && attemptsCandidate <= 1
    ? attemptsCandidate
    : 0;
  console.log(JSON.stringify({
    automaticDteWorker: "ok",
    processed: result.processed === true,
    status,
    siiContacted: result.siiContacted === true,
    networkAttempts,
  }));
} catch {
  console.error("automaticDteWorker=unavailable");
  process.exit(1);
}
