import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import {
  hashManageToken,
  isUsableManageTokenRecord,
  safeTokenHashEqual,
} from "@/lib/security/manage-tokens.mjs";

export type AppointmentAccessRow = {
  id: string;
  tenant_id: string;
  manage_token?: string | null;
  manage_token_hash?: string | null;
  manage_token_expires_at?: string | null;
  manage_token_revoked_at?: string | null;
  manage_token_legacy_expires_at?: string | null;
};

export type AppointmentActor =
  | { ok: true; actor: "admin"; userId: string }
  | { ok: true; actor: "manage_token"; userId: null }
  | { ok: false };

function suppliedManageToken(req: Request, explicit?: unknown) {
  const url = new URL(req.url);
  return String(
    explicit ??
      req.headers.get("x-manage-token") ??
      url.searchParams.get("manageToken") ??
      url.searchParams.get("token") ??
      "",
  ).trim();
}

function validLegacyToken(appointment: AppointmentAccessRow, token: string) {
  const legacyExpiry = new Date(
    appointment.manage_token_legacy_expires_at ?? "",
  ).getTime();
  return (
    Boolean(appointment.manage_token) &&
    Number.isFinite(legacyExpiry) &&
    legacyExpiry > Date.now() &&
    safeTokenHashEqual(appointment.manage_token, token)
  );
}

export async function authorizeAppointmentActor(input: {
  req: Request;
  appointment: AppointmentAccessRow;
  manageToken?: unknown;
}): Promise<AppointmentActor> {
  const admin = await requireTenantAdmin({
    req: input.req,
    tenantId: input.appointment.tenant_id,
  });
  if (admin.ok) return { ok: true, actor: "admin", userId: admin.userId };

  const token = suppliedManageToken(input.req, input.manageToken);
  if (!token || token.length < 32 || token.length > 256) return { ok: false };

  const pepper = process.env.CITAYA_MANAGE_TOKEN_PEPPER?.trim();
  if (
    pepper &&
    input.appointment.manage_token_hash &&
    isUsableManageTokenRecord(input.appointment) &&
    safeTokenHashEqual(
      input.appointment.manage_token_hash,
      hashManageToken(token, pepper),
    )
  ) {
    return { ok: true, actor: "manage_token", userId: null };
  }

  return validLegacyToken(input.appointment, token)
    ? { ok: true, actor: "manage_token", userId: null }
    : { ok: false };
}

export async function rotateAppointmentManageToken(appointmentId: string) {
  const {
    generateManageToken,
    hashManageToken,
    manageTokenExpiresAt,
  } = await import("@/lib/security/manage-tokens.mjs");
  const pepper = process.env.CITAYA_MANAGE_TOKEN_PEPPER?.trim();
  if (!pepper) throw new Error("Manage token configuration missing");
  const token = generateManageToken();
  const { error } = await supabaseAdmin
    .from("appointments")
    .update({
      manage_token: null,
      manage_token_hash: hashManageToken(token, pepper),
      manage_token_expires_at: manageTokenExpiresAt(),
      manage_token_revoked_at: null,
      manage_token_rotated_at: new Date().toISOString(),
      manage_token_legacy_expires_at: null,
    })
    .eq("id", appointmentId);
  if (error) throw error;
  return token;
}

export async function revokeAppointmentManageToken(appointmentId: string) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("appointments")
    .update({
      manage_token: null,
      manage_token_revoked_at: now,
      manage_token_legacy_expires_at: null,
    })
    .eq("id", appointmentId);
  if (error) throw error;
}
