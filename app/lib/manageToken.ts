// app/lib/manageToken.ts
import crypto from "crypto";

/**
 * Genera un token seguro para gestionar la cita sin login.
 * - 32 bytes = 256 bits de entropía
 * - base64url = amigable para URLs (sin + / =)
 */
export function generateManageToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
