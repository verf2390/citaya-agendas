// Compatibility endpoint. The canonical implementation defaults to Mercado Pago
// and enforces the same authorization, idempotency and server-side amount rules.
export { POST } from "@/app/api/payments/create/route";
