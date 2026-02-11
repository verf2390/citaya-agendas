import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";

export async function parseJson<T>(req: Request, schema: ZodSchema<T>) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return {
      ok: false as const,
      res: NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    const first = parsed.error.issues?.[0];
    const msg = first
      ? `${first.path.join(".") || "body"}: ${first.message}`
      : "Payload inválido";

    return {
      ok: false as const,
      res: NextResponse.json({ ok: false, error: msg }, { status: 400 }),
    };
  }

  return { ok: true as const, data: parsed.data };
}
