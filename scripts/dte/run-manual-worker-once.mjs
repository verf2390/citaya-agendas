const secret = String(process.env.DTE_WORKER_SECRET ?? "");
const targetOutboxId = String(process.env.DTE_TARGET_OUTBOX_ID ?? "").trim();
if (secret.length < 32) {
  console.error("manualDteWorker=misconfigured");
  process.exit(1);
}
if (targetOutboxId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetOutboxId)) {
  console.error("manualDteWorker=target_invalid");
  process.exit(1);
}

try {
  const response = await fetch("http://127.0.0.1:3000/api/internal/dte-worker", {
    method: "POST",
    headers: {
      "x-citaya-worker-secret": secret,
      "content-type": "application/json",
    },
    body: JSON.stringify(targetOutboxId ? { targetOutboxId } : {}),
    signal: AbortSignal.timeout(14 * 60 * 1000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    console.error(`manualDteWorker=http_${response.status}`);
    process.exit(1);
  }
  const result = payload.result ?? {};
  console.log(JSON.stringify({
    manualDteWorker: "ok",
    processed: result.processed === true,
    status: result.status ?? null,
    siiContacted: result.siiContacted === true,
    networkAttempts: Number(result.networkAttempts ?? 0),
  }));
} catch {
  console.error("manualDteWorker=unavailable");
  process.exit(1);
}
