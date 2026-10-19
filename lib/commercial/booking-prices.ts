// CIT-129: tarifas comerciales aprobadas para nuevas propuestas de CITAYA Agendas.
// Valores netos en pesos chilenos. NO es el motor de cobro ni modifica suscripciones activas.
// Revisar siempre habilitación de funciones por tenant antes de ofrecerlas.
export const BOOKING_PRICES_CLP = {
  inicioMonthlyNet: 14990,
  profesionalMonthlyNet: 29990,
  implementationNet: 30990,
} as const;

export const BOOKING_DEMO_TERMS =
  "Demo gratuita, sin compromiso. La duración se acuerda según cada negocio.";

export const BOOKING_EXCLUSIONS =
  "Inteligencia artificial y Video Studio no están incluidos; se cotizan por separado.";

export function formatBookingPriceCLP(net: number): string {
  return `$${new Intl.NumberFormat("es-CL").format(net)}`;
}
