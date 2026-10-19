// CIT-134. Tarifario comercial aprobado para nuevas cotizaciones, 19-10-2026.
// Montos NETOS en CLP: siempre comunicar "+ IVA".
// Esto NO modifica cobros, contratos, suscripciones ni servicios ya contratados.
export const WEB_SERVICE_PRICES_CLP = {
  presencia: 199990,
  negocios: 449990,
  premiumFrom: 799990,
  customSoftwareFrom: 1490000,
  audit: 99990,
  optimizationFrom: 149990,
  maintenanceMonthlyFrom: 34990,
} as const;

export function formatWebServicePriceCLP(amount: number): string {
  return `$${new Intl.NumberFormat("es-CL").format(amount)}`;
}
