// lib/types.ts

export type AppointmentStatus = "confirmed" | "completed" | "canceled" | "no_show";

/**
 * Fila que nos interesa para disponibilidad (MVP).
 * Usamos strings porque Supabase devuelve timestamptz como string ISO.
 */
export type AppointmentRangeRow = {
  start_at: string;
  end_at: string;
  status: string | null;
};

export type BookedRange = { start: Date; end: Date };

export type Slot = { start_at: string; end_at: string };
