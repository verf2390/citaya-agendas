"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { normalizeCLPhone } from "@/app/lib/phone";

export default function CustomerUpsertModal(props: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  initial?: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null;
  onSaved: (row: { id: string; full_name: string; phone: string | null; email: string | null }) => void;
}) {
  const { open, onClose, tenantId, initial, onSaved } = props;

  const isEdit = !!initial?.id;

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(initial?.full_name ?? "");
    setPhone(initial?.phone ?? "");
    setEmail(initial?.email ?? "");
  }, [open, initial]);

  // ✅ Cerrar con ESC
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") {
        // Enter guarda (si estás escribiendo)
        e.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fullName, phone, email, tenantId, initial, onClose]);

  const phoneNormalized = useMemo(() => normalizeCLPhone(phone), [phone]);

  const canSave = useMemo(() => {
    if (fullName.trim().length < 2) return false;
    if (phoneNormalized.length < 9) return false; // regla simple MVP
    return true;
  }, [fullName, phoneNormalized]);

  const handleSave = async () => {
    if (!canSave || saving) return;

    setSaving(true);

    const payload = {
      tenant_id: tenantId,
      full_name: fullName.trim(),
      phone: phoneNormalized,
      email: email.trim() ? email.trim() : null,
    };

    if (!isEdit) {
      const { data, error } = await supabase
        .from("customers")
        .insert([payload])
        .select("id, full_name, phone, email")
        .single();

      if (error) {
        console.error("Error creating customer:", error);
        alert("Error creando cliente");
        setSaving(false);
        return;
      }

      onSaved(data);
      setSaving(false);
      onClose();
      return;
    }

    const { data, error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", initial!.id)
      .eq("tenant_id", tenantId)
      .select("id, full_name, phone, email")
      .single();

    if (error) {
      console.error("Error updating customer:", error);
      alert("Error editando cliente");
      setSaving(false);
      return;
    }

    onSaved(data);
    setSaving(false);
    onClose();
  };

  if (!open) return null;

  return (
    // ✅ Click afuera cierra
    <div
      onClick={() => {
        if (!saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 80,
      }}
    >
      {/* ✅ Click dentro NO cierra */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          background: "white",
          borderRadius: 12,
          border: "1px solid #e5e5e5",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800 }}>{isEdit ? "Editar cliente" : "Nuevo cliente"}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Teléfono se guardará como: <b>{phoneNormalized || "-"}</b>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            Cerrar
          </button>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Nombre *</div>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: Juan Pérez"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Teléfono (WhatsApp) *</div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 9 1234 5678"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Email (opcional)</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ej: cliente@email.com"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#111",
              color: "white",
              cursor: !canSave || saving ? "not-allowed" : "pointer",
              opacity: !canSave || saving ? 0.5 : 1,
            }}
          >
            {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear cliente"}
          </button>

          <div style={{ fontSize: 11, opacity: 0.6 }}>
            Tip: ESC para cerrar • Enter para guardar
          </div>
        </div>
      </div>
    </div>
  );
}
