export const runtime = "nodejs";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  runOneAutomaticIssuanceWorker,
  runOneManualIssuanceWorker,
} from "@/lib/dte/automation/worker";

function authorized(req: Request) {
  const expected = String(process.env.DTE_WORKER_SECRET ?? "");
  const provided = String(req.headers.get("x-citaya-worker-secret") ?? "");
  if (expected.length < 32 || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 404 });
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === undefined ? "manual" : body.mode;
    if (mode !== "manual" && mode !== "automatic") {
      return NextResponse.json({ ok: false, error: "DTE_WORKER_MODE_INVALID" }, { status: 400 });
    }
    if (mode === "automatic") {
      const result = await runOneAutomaticIssuanceWorker();
      return NextResponse.json({ ok: true, result });
    }
    const targetOutboxId = typeof body?.targetOutboxId === "string"
      ? body.targetOutboxId
      : undefined;
    const controlledResume = body?.controlledResume &&
      typeof body.controlledResume === "object"
      ? body.controlledResume : undefined;
    const result = await runOneManualIssuanceWorker({ targetOutboxId, controlledResume });
    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json({ ok: false, error: "DTE_WORKER_FAILED" }, { status: 503 });
  }
}
