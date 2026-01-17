// lib/availability.ts
// Validación de disponibilidad (bloques horarios por profesional)

export type AvailabilityBlock = {
  professional_id: string;
  day_of_week: number; // 0-6 (domingo=0)
  start_time: string;  // "09:00:00" o "09:00"
  end_time: string;    // "18:00:00" o "18:00"
};

// Convierte "HH:MM:SS" o "HH:MM" a minutos desde 00:00
export function timeToMinutes(time: string) {
  const [hh, mm] = time.split(":").map(Number);
  return hh * 60 + mm;
}

// Convierte un Date a minutos
export function dateToMinutes(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Retorna TRUE si el rango [startMin, endMin] cae COMPLETO dentro
 * de al menos 1 bloque del día.
 */
export function isWithinAvailability(params: {
  startMin: number;
  endMin: number;
  blocks: AvailabilityBlock[];
}) {
  const { startMin, endMin, blocks } = params;

  // Si no hay disponibilidad cargada para ese día => bloquear
  if (!blocks || blocks.length === 0) return false;

  return blocks.some((b) => {
    const blockStart = timeToMinutes(b.start_time);
    const blockEnd = timeToMinutes(b.end_time);

    // Acepta contiguo: end == blockEnd está ok
    return startMin >= blockStart && endMin <= blockEnd;
  });
}
