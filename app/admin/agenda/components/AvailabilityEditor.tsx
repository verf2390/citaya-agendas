"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save } from "lucide-react";

type Block = {
  tempId: string;          // id estable UI
  id?: string;             // id DB (uuid) si existe
  day_of_week: number;     // 0-6
  start_time: string;      // "HH:MM"
  end_time: string;        // "HH:MM"
  is_active: boolean;
};

const DAYS = [
  { key: 1, label: "Lunes" },
  { key: 2, label: "Martes" },
  { key: 3, label: "Miércoles" },
  { key: 4, label: "Jueves" },
  { key: 5, label: "Viernes" },
  { key: 6, label: "Sábado" },
  { key: 0, label: "Domingo" },
];

function makeTempId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampTime(t: string) {
  // Acepta "HH:MM" o "HH:MM:SS" y normaliza a "HH:MM"
  if (!t) return "09:00";
  const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return "09:00";
  const hh = m[1];
  const mm = m[2];
  if (hh < "00" || hh > "23" || mm < "00" || mm > "59") return "09:00";
  return `${hh}:${mm}`;
}

function timeToMinutes(hhmm: string) {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  // interval overlap: [aStart,aEnd) intersects [bStart,bEnd)
  return aStart < bEnd && bStart < aEnd;
}

type ApiListItem = {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

export function AvailabilityEditor({
  professionalId,
}: {
  professionalId: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<number, Block[]>();
    for (const b of blocks) {
      const arr = m.get(b.day_of_week) ?? [];
      arr.push(b);
      m.set(b.day_of_week, arr);
    }
    // orden por start_time dentro del día
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => a.start_time.localeCompare(b.start_time));
      m.set(k, arr);
    }
    return m;
  }, [blocks]);

  // --- LOAD ---
  useEffect(() => {
    if (!professionalId) {
      setBlocks([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setOkMsg(null);

    fetch(
      `/api/admin/availability/list?professionalId=${encodeURIComponent(
        professionalId
      )}`
    )
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? "Error cargando availability");
        return j;
      })
      .then((j) => {
        if (cancelled) return;

        const items: ApiListItem[] = Array.isArray(j.items) ? j.items : [];

        const next: Block[] = items.map((x) => {
          const st = clampTime(x.start_time?.slice(0, 5) ?? x.start_time);
          const et = clampTime(x.end_time?.slice(0, 5) ?? x.end_time);

          // tempId estable: si hay id, úsalo para que sea estable entre recargas
          const tempId = x.id ? `db-${x.id}` : makeTempId();

          return {
            tempId,
            id: x.id,
            day_of_week: x.day_of_week,
            start_time: st,
            end_time: et,
            is_active: !!x.is_active,
          };
        });

        setBlocks(next);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [professionalId]);

  // --- CRUD UI ---
  function addBlock(day: number) {
    setError(null);
    setOkMsg(null);

    setBlocks((prev) => [
      ...prev,
      {
        tempId: makeTempId(),
        day_of_week: day,
        start_time: "10:00",
        end_time: "19:00",
        is_active: true,
      },
    ]);
  }

  function removeBlock(tempId: string) {
    setError(null);
    setOkMsg(null);
    setBlocks((prev) => prev.filter((b) => b.tempId !== tempId));
  }

  function updateBlock(tempId: string, patch: Partial<Block>) {
    setError(null);
    setOkMsg(null);
    setBlocks((prev) =>
      prev.map((b) => (b.tempId === tempId ? { ...b, ...patch } : b))
    );
  }

  // --- VALIDATION (paso 2) ---
  function validateAll(current: Block[]) {
    // normaliza horas + checks base
    const normalized = current.map((b) => ({
      ...b,
      start_time: clampTime(b.start_time),
      end_time: clampTime(b.end_time),
    }));

    // 1) start < end
    for (const b of normalized) {
      if (timeToMinutes(b.start_time) >= timeToMinutes(b.end_time)) {
        return {
          ok: false as const,
          message: `Bloque inválido: ${labelDay(b.day_of_week)} (${b.start_time}–${b.end_time}). La hora de inicio debe ser menor que la de fin.`,
          normalized,
        };
      }
    }

    // 2) no overlaps por día (solo entre bloques activos/inactivos? => yo lo valido igual, porque si se activa después rompe)
    // Puedes cambiarlo a "solo activos" si quieres.
    const byDay = new Map<number, Block[]>();
    for (const b of normalized) {
      const arr = byDay.get(b.day_of_week) ?? [];
      arr.push(b);
      byDay.set(b.day_of_week, arr);
    }

    for (const [day, arr] of byDay.entries()) {
      const sorted = [...arr].sort((a, b) =>
        a.start_time.localeCompare(b.start_time)
      );

      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const A = sorted[i];
          const B = sorted[j];
          // Como está ordenado por start, si B.start >= A.end ya no hay solapamiento con A
          if (B.start_time >= A.end_time) break;

          if (overlaps(A.start_time, A.end_time, B.start_time, B.end_time)) {
            return {
              ok: false as const,
              message: `Bloques superpuestos en ${labelDay(day)}: (${A.start_time}–${A.end_time}) y (${B.start_time}–${B.end_time}).`,
              normalized,
            };
          }
        }
      }
    }

    // 3) opcional: no duplicados exactos
    const seen = new Set<string>();
    for (const b of normalized) {
      const k = `${b.day_of_week}|${b.start_time}|${b.end_time}|${b.is_active}`;
      if (seen.has(k)) {
        return {
          ok: false as const,
          message: `Bloque duplicado detectado en ${labelDay(b.day_of_week)} (${b.start_time}–${b.end_time}).`,
          normalized,
        };
      }
      seen.add(k);
    }

    return { ok: true as const, normalized };
  }

  function labelDay(day: number) {
    return DAYS.find((d) => d.key === day)?.label ?? `Día ${day}`;
  }

  // --- SAVE (bulk robusto) ---
  async function save() {
    if (!professionalId) return;

    setSaving(true);
    setError(null);
    setOkMsg(null);

    try {
      // validar + normalizar antes de guardar
      const result = validateAll(blocks);
      if (!result.ok) {
        // actualiza state con horas normalizadas igual para que el usuario vea formato correcto
        setBlocks(result.normalized);
        throw new Error(result.message);
      }

      // aplica normalización en state (opcional)
      setBlocks(result.normalized);

      const payload = {
        professionalId,
        // mandamos id si existe + datos (tempId no se guarda en DB)
        blocks: result.normalized.map((b) => ({
          id: b.id ?? null,
          day_of_week: b.day_of_week,
          start_time: b.start_time, // "HH:MM"
          end_time: b.end_time,
          is_active: b.is_active,
        })),
      };

      const res = await fetch("/api/admin/availability/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Error guardando horarios");

      // Si backend devuelve items actualizados con id, refrescamos desde respuesta para amarrar IDs
      // Esperado: { items, inserted, updated, deleted }
      if (Array.isArray(j.items)) {
        const refreshed: Block[] = (j.items as ApiListItem[]).map((x) => ({
          tempId: x.id ? `db-${x.id}` : makeTempId(),
          id: x.id,
          day_of_week: x.day_of_week,
          start_time: clampTime(x.start_time?.slice(0, 5) ?? x.start_time),
          end_time: clampTime(x.end_time?.slice(0, 5) ?? x.end_time),
          is_active: !!x.is_active,
        }));
        setBlocks(refreshed);
      }

      const inserted = Number(j.inserted ?? 0);
      const updated = Number(j.updated ?? 0);
      const deleted = Number(j.deleted ?? 0);

      if (inserted || updated || deleted) {
        setOkMsg(`Guardado OK ( +${inserted} / ~${updated} / -${deleted} )`);
      } else {
        setOkMsg("Guardado OK");
      }
    } catch (e: any) {
      setError(e.message ?? "Error guardando");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 rounded-2xl border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Horarios</div>
          <div className="text-sm text-muted-foreground">
            Define bloques por día. Esto impacta /reservar en tiempo real.
          </div>
        </div>

        <Button onClick={save} disabled={!professionalId || saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </div>

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      {okMsg && <div className="mt-3 text-sm text-green-600">{okMsg}</div>}
      {loading && <div className="mt-3 text-sm text-muted-foreground">Cargando horarios...</div>}
      {!professionalId && <div className="mt-3 text-sm text-muted-foreground">Selecciona un profesional.</div>}

      <div className="mt-4 grid gap-3">
        {DAYS.map((d) => {
          const dayBlocks = grouped.get(d.key) ?? [];

          return (
            <div key={d.key} className="rounded-2xl border p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">{d.label}</div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => addBlock(d.key)}
                  disabled={!professionalId}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" /> Agregar bloque
                </Button>
              </div>

              <div className="mt-3 grid gap-2">
                {dayBlocks.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Sin bloques</div>
                ) : (
                  dayBlocks.map((b) => (
                    <div
                      key={b.tempId}
                      className="flex flex-wrap items-center gap-3 rounded-xl border p-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Inicio</span>
                        <input
                          type="time"
                          value={b.start_time}
                          onChange={(e) =>
                            updateBlock(b.tempId, { start_time: clampTime(e.target.value) })
                          }
                          className="h-9 rounded-lg border px-2 text-sm"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Fin</span>
                        <input
                          type="time"
                          value={b.end_time}
                          onChange={(e) =>
                            updateBlock(b.tempId, { end_time: clampTime(e.target.value) })
                          }
                          className="h-9 rounded-lg border px-2 text-sm"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Activo</span>
                        <Switch
                          checked={b.is_active}
                          onCheckedChange={(v) =>
                            updateBlock(b.tempId, { is_active: !!v })
                          }
                        />
                      </div>

                      <div className="ml-auto">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeBlock(b.tempId)}
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
