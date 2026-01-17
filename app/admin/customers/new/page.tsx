"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

// ⚠️ MVP: tenant hardcodeado. Luego lo sacamos desde profiles/slug.
const TENANT_ID = "04d6c088-338d-44b2-b27b-b4709f48d31b";

export default function NewCustomerPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  // ✅ Guard de sesión
  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login?redirectTo=/admin/customers/new");
        return;
      }
      setAuthChecked(true);
    };
    run();
  }, [router]);

  const onSave = async () => {
    const name = fullName.trim();
    if (!name) {
      alert("El nombre es obligatorio");
      return;
    }

    // ✅ Normaliza teléfono: solo números (MVP)
    let phoneDigits = phone.trim().replace(/\D/g, "");
    if (phoneDigits.length === 9 && phoneDigits.startsWith("9")) {
      phoneDigits = "56" + phoneDigits; // 569XXXXXXXX
    }

    setSaving(true);

    const { error } = await supabase.from("customers").insert([
      {
        tenant_id: TENANT_ID,
        full_name: name,
        phone: phoneDigits || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      },
    ]);

    setSaving(false);

    if (error) {
      console.error("Error creando cliente:", error);
      alert("Error creando cliente");
      return;
    }

    router.push("/admin/customers");
  };

  if (!authChecked) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Validando sesión...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, fontFamily: "system-ui", maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Nuevo cliente</h1>
        <Link href="/admin/customers" style={{ textDecoration: "none" }}>
          ← Volver
        </Link>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Nombre *</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ej: Juan Pérez"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Teléfono (opcional)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ej: 956655664 (o +56 9 5665 5664)"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Correo (opcional)</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Ej: juan@mail.com"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Notas (opcional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Preferencias, alergias, observaciones…"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", minHeight: 90 }}
          />
        </label>

        <button
          onClick={onSave}
          disabled={saving}
          style={{
            marginTop: 6,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: saving ? "#f5f5f5" : "white",
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </main>
  );
}
