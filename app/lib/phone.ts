// app/lib/phone.ts
export function digitsOnly(input: string) {
  return (input || "").replace(/\D/g, "");
}

/**
 * Normaliza teléfono Chile para guardarlo:
 * - "9XXXXXXXX" => "569XXXXXXXX"
 * - "569XXXXXXXX" => queda igual
 * - cualquier otro => solo dígitos
 */
export function normalizeCLPhone(input: string) {
  let p = digitsOnly(input);

  if (p.length === 9 && p.startsWith("9")) p = "56" + p; // => 569XXXXXXXX
  return p;
}

/**
 * Para WA: aseguramos formato numérico sin + y con 56 si venía 9XXXXXXXX
 */
export function normalizePhoneToWhatsApp(input: string) {
  return normalizeCLPhone(input);
}
