export const runtime = "nodejs";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { runOneManualIssuanceWorker } from "@/lib/dte/automation/worker";

function authorized(req: Request) {
  const expected = String(process.env.DTE_WORKER_SECRET ?? "");
  const provided = String(req.headers.get("x-citaya-worker-secret") ?? "");
  if (expected.length < 32 || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 404 });
  try {
    const result = await runOneManualIssuanceWorker();
    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json({ ok: false, error: "DTE_WORKER_FAILED" }, { status: 503 });
  }
}
