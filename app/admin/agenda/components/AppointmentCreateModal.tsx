"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type CustomerLite = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;

  startISO: string;
  endISO: string;

  customers: CustomerLite[];

  onConfirm: (args: { customerId: string }) => Promise<void> | void;

  tenantId: string;

  onCreatedCustomer?: (c: CustomerLite) => void;
};

type PostgrestErrorLike = {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null; // Postgres error code (ej: 23505)
  status?: number; // HTTP status (a veces viene)
};

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

function normalizePhone(raw: string) {
  let p = raw.replace(/\D/g, "");
  if (p.length === 9 && p.startsWith("9")) p = "56" + p; // 9XXXXXXXX => 569XXXXXXXX
  return p;
}

function isDuplicateCustomerError(err: PostgrestErrorLike | null) {
  if (!err) return false;

  // Postgres unique violation
  if (err.code === "23505") return true;

  // a veces PostgREST manda status 409 en conflictos
  if (err.status === 409) return true;

  const msg = (err.message ?? "").toLowerCase();
  const details = (err.details ?? "").toLowerCase();

  // fallback por texto (depende de cómo venga)
  if (msg.includes("duplicate") || msg.includes("unique")) return true;
  if (details.includes("duplicate") || details.includes("unique")) return true;

  return false;
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

  // Reset cada vez que abres el modal
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
   * Filtrado local:
   * - Si usuario escribe <2 => no mostrar lista
   * - >=2 => filtra por nombre o teléfono
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

  async function getBearerTokenOrNull(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function findCustomerByPhone(phoneNormalized: string) {
    // ⚠️ Antes: consultaba directamente customers (RLS). Ahora lo resolvemos con API create (reused=true)
    // Para mantener la lógica (y no romper UX), devolvemos null acá y dejamos que el flujo de "duplicado"
    // se resuelva por el mismo endpoint (que ya reusa por phone/email).
    // Igual, intentamos un match local en customers[] para seleccionar si ya está en memoria.
    const local = customers.find((c) => (c.phone ?? "") === phoneNormalized);
    return local ?? null;
  }

  const handleCreateCustomer = async () => {
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

      const token = await getBearerTokenOrNull();
      if (!token) {
        alert("Sesión expirada. Vuelve a iniciar sesión.");
        return;
      }

      // ✅ NUEVO: Crear/Reusar cliente vía API server-side (evita RLS 403)
      const res = await fetch("/api/customers/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantId,
          name,
          phone: phoneNormalized,
          email,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        console.error("Error creating customer (API):", json);
        alert("No se pudo crear el cliente (revisa consola).");
        return;
      }

      // ✅ El endpoint puede:
      // - crear (reused=false)
      // - reusar existente por phone/email (reused=true)
      const customerId = String(json.customerId || "");

      // Intentamos seleccionar usando memoria local; si no existe, construimos lite.
      const localExisting = customers.find((c) => c.id === customerId) || (await findCustomerByPhone(phoneNormalized));

      if (json.reused && localExisting) {
        alert("Ya existe un cliente con este teléfono. Seleccionándolo para agendar.");
        setSelected(localExisting);
        setQ(localExisting.name);
        setShowCreate(false);
        onCreatedCustomer?.(localExisting);
        return;
      }

      // Si no estaba en memoria (o fue creado), armamos el objeto para UI
      const created: CustomerLite = {
        id: customerId,
        name,
        phone: phoneNormalized,
        email,
      };

      // seleccionar automáticamente
      setSelected(created);
      setQ(created.name);

      // avisar al parent
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

          {/* Crear cliente si no existe */}
          {nothingFound && !showCreate && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => {
                  setShowCreate(true);
                  setNewName(q.trim());
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
                  placeholder="Teléfono (WhatsApp obligatorio, sin duplicados)"
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
        </div>
      </div>
    </div>
  );
}
