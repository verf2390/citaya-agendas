"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type CustomerLite = {
  id: string;
  name: string;
  phone: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;

  startISO: string;
  endISO: string;

  customers: CustomerLite[];

  // ✅ cuando el usuario confirma con un customerId
  onConfirm: (args: { customerId: string }) => Promise<void> | void;

  // ✅ tenant (MVP hardcodeado en agenda page)
  tenantId: string;

  // ✅ opcional: para que el parent recargue customers si quiere
  onCreatedCustomer?: (c: CustomerLite) => void;
};

/**
 * ✅ Muestra el rango de la cita de forma humana (no ISO feo)
 */
function formatSlotLabel(startISO: string, endISO: string) {
  if (!startISO || !endISO) return "";
  const start = new Date(startISO);
  const end = new Date(endISO);

  const date = start.toLocaleDateString("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const startTime = start.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });

  return `📅 ${date} • 🕒 ${startTime} – ${endTime}`;
}

/**
 * ✅ Normaliza teléfono:
 * - deja solo números
 * - si viene como 9XXXXXXXX => 569XXXXXXXX
 */
function normalizePhone(raw: string) {
  let p = raw.replace(/\D/g, "");
  if (p.length === 9 && p.startsWith("9")) p = "56" + p;
  return p;
}

export default function AppointmentCreateModal({
  open,
  onClose,
  startISO,
  endISO,
  customers,
  onConfirm,
  tenantId,
  onCreatedCustomer,
}: Props) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CustomerLite | null>(null);
  const [saving, setSaving] = useState(false);

  // UI: crear cliente inline
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // ✅ Reset cada vez que abres el modal
  useEffect(() => {
    if (!open) return;

    setQ("");
    setSelected(null);
    setSaving(false);

    setShowCreate(false);
    setNewName("");
    setNewPhone("");
    setNewEmail("");
  }, [open]);

  /**
   * ✅ Filtrado local:
   * - si <2 chars => no mostramos lista
   * - si >=2 => filtra por nombre o teléfono
   *
   * (Luego, cuando tengas muchos clientes, lo pasamos a búsqueda server-side)
   */
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];

    return customers.filter((c) => {
      const name = c.name.toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      return name.includes(query) || phone.includes(query);
    });
  }, [q, customers]);

  const nothingFound = q.trim().length >= 2 && filtered.length === 0;

  /**
   * ✅ PRO: auto-selección si hay match exacto por nombre
   * Ej: escribes "Juan Perez" y existe => se selecciona solo
   */
  useEffect(() => {
    const query = q.trim().toLowerCase();
    if (!query) return;

    const exact = customers.find((c) => c.name.toLowerCase() === query);
    if (exact) setSelected(exact);
  }, [q, customers]);

  const handleCreateCustomer = async () => {
    // ✅ Validaciones (nombre + teléfono obligatorio)
    const name = newName.trim();
    if (!name) {
      alert("Ingresa el nombre del cliente");
      return;
    }

    const phoneNormalized = normalizePhone(newPhone.trim());
    if (!phoneNormalized) {
      alert("El teléfono es obligatorio (WhatsApp).");
      return;
    }

    setSaving(true);
    try {
      const email = newEmail.trim() || null;

      const { data, error } = await supabase
        .from("customers")
        .insert([
          {
            tenant_id: tenantId,
            full_name: name,
            phone: phoneNormalized, // ✅ obligatorio
            email, // opcional
          },
        ])
        .select("id, full_name, phone")
        .single();

      if (error) {
        console.error("Error creating customer:", error);
        alert("No se pudo crear el cliente (revisa consola).");
        return;
      }

      const created: CustomerLite = {
        id: data.id,
        name: data.full_name,
        phone: data.phone ?? null,
      };

      // ✅ seleccionar automáticamente
      setSelected(created);
      setQ(created.name);

      // ✅ avisar al parent para que lo agregue a la lista sin recargar
      onCreatedCustomer?.(created);

      // cerrar mini-form
      setShowCreate(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await onConfirm({ customerId: selected.id });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  /**
   * ✅ PRO:
   * - ESC = cerrar
   * - ENTER:
   *    - si estás creando cliente => crear cliente
   *    - si hay cliente seleccionado => confirmar cita
   */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Enter") {
        if (showCreate) {
          handleCreateCustomer();
          return;
        }
        if (selected) {
          handleConfirm();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showCreate, selected]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          background: "white",
          borderRadius: 12,
          border: "1px solid #e5e5e5",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Nueva cita</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{formatSlotLabel(startISO, endISO)}</div>
          </div>

          <button
            onClick={onClose}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Cerrar
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Buscar cliente</div>

          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(null);
            }}
            placeholder="Escribe al menos 2 letras (nombre o teléfono)..."
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              outline: "none",
            }}
          />

          <div style={{ marginTop: 10, maxHeight: 220, overflow: "auto", border: "1px solid #eee", borderRadius: 10 }}>
            {q.trim().length < 2 ? (
              <div style={{ padding: 12, fontSize: 13, opacity: 0.75 }}>Escribe al menos 2 letras para buscar.</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 12, fontSize: 13, opacity: 0.75 }}>No encontrado.</div>
            ) : (
              filtered.map((c) => {
                const active = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      borderBottom: "1px solid #f2f2f2",
                      background: active ? "rgba(0,0,0,0.04)" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{c.phone ?? ""}</div>
                  </button>
                );
              })
            )}
          </div>

          {/* ✅ Crear cliente si no existe */}
          {nothingFound && !showCreate && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => {
                  setShowCreate(true);
                  setNewName(q.trim()); // precarga con lo escrito
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                + Crear cliente
              </button>
            </div>
          )}

          {showCreate && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Crear cliente</div>

              <div style={{ display: "grid", gap: 8 }}>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre completo"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                />
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Teléfono (WhatsApp obligatorio)"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                />
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Email (opcional)"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                />

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowCreate(false)}
                    disabled={saving}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #ddd",
                      background: "white",
                      cursor: "pointer",
                    }}
                  >
                    Cancelar
                  </button>

                  <button
                    onClick={handleCreateCustomer}
                    disabled={saving}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #111",
                      background: "#111",
                      color: "white",
                      cursor: "pointer",
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    Guardar cliente
                  </button>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button
              onClick={onClose}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>

            <button
              onClick={handleConfirm}
              disabled={!selected || saving}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "white",
                cursor: !selected ? "not-allowed" : "pointer",
                opacity: !selected || saving ? 0.6 : 1,
              }}
            >
              Confirmar cita
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
            Tip: Enter = confirmar • Esc = cerrar
          </div>
        </div>
      </div>
    </div>
  );
}
