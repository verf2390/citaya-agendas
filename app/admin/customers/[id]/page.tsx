"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// ⚠️ MVP: tenant hardcodeado. Luego lo sacamos desde profiles/slug.
const TENANT_ID = "04d6c088-338d-44b2-b27b-b4709f48d31b";

type Customer = {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

export default function EditCustomerPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? "");

  const [authChecked, setAuthChecked] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  // ✅ Guard de sesión
  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?redirectTo=/admin/customers/${id}`);
        return;
      }
      setAuthChecked(true);
    };
    run();
  }, [router, id]);

  const loadCustomer = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customers")
      .select("id, tenant_id, full_name, phone, email, notes")
      .eq("tenant_id", TENANT_ID)
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error loading customer:", error);
      alert("No se pudo cargar el cliente");
      router.push("/admin/customers");
      return;
    }

    const c = data as Customer;
    setFullName(c.full_name ?? "");
    setPhone(c.phone ?? "");
    setEmail(c.email ?? "");
    setNotes(c.notes ?? "");

    setLoading(false);
  };

  useEffect(() => {
    if (!authChecked) return;
    if (!id) return;
    loadCustomer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, id]);

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

    const { error } = await supabase
      .from("customers")
      .update({
        full_name: name,
        phone: phoneDigits || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      })
      .eq("tenant_id", TENANT_ID)
      .eq("id", id);

    setSaving(false);

    if (error) {
      console.error("Error updating customer:", error);
      alert("Error guardando cambios");
      return;
    }

    router.push("/admin/customers");
  };

  const onDelete = async () => {
    const ok = confirm("¿Eliminar este cliente? (No se borran citas, solo el cliente)");
    if (!ok) return;

    setDeleting(true);

    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("tenant_id", TENANT_ID)
      .eq("id", id);

    setDeleting(false);

    if (error) {
      console.error("Error deleting customer:", error);
      alert("Error eliminando cliente");
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

  if (loading) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>Cargando cliente...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, fontFamily: "system-ui", maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Editar cliente</h1>
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
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Notas (opcional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", minHeight: 90 }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: saving ? "#f5f5f5" : "white",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>

          <button
            onClick={onDelete}
            disabled={deleting}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #f2c2c2",
              background: deleting ? "#fdf2f2" : "white",
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            {deleting ? "Eliminando..." : "Eliminar"}
          </button>
        </div>

        <p style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Nota: si el cliente tiene citas relacionadas, como tu FK es <code>ON DELETE SET NULL</code>, las citas quedan pero el <code>customer_id</code> se limpia.
        </p>
      </div>
    </main>
  );
}
