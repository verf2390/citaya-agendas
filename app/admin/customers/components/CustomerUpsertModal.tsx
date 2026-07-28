"use client";

import { adminFetch } from "@/lib/api/adminFetch";

import { useEffect, useMemo, useState } from "react";
import { normalizeCLPhone } from "@/app/lib/phone";
import { toast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { normalizeRut, validateRut } from "@/lib/dte/rut";

type InitialCustomer = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  rut_normalized?: string | null;
};

export default function CustomerUpsertModal(props: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  initial?: InitialCustomer | null;
  onSaved: (result: { id: string; reused: boolean }) => void;
}) {
  const { open, onClose, tenantId, initial, onSaved } = props;

  const isEdit = !!initial?.id;

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [customerRut, setCustomerRut] = useState("");
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxLegalName, setTaxLegalName] = useState("");
  const [taxActivity, setTaxActivity] = useState("");
  const [taxAddress, setTaxAddress] = useState("");
  const [taxCommune, setTaxCommune] = useState("");
  const [taxCity, setTaxCity] = useState("");
  const [taxEmail, setTaxEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(initial?.full_name ?? "");
    setPhone(initial?.phone ?? "");
    setEmail(initial?.email ?? "");
    setCustomerRut(initial?.rut_normalized ?? "");
    setTaxEnabled(false);
    setTaxLegalName(""); setTaxActivity(""); setTaxAddress("");
    setTaxCommune(""); setTaxCity(""); setTaxEmail("");
    if (initial?.id) {
      void adminFetch("/api/admin/customers/" + initial.id + "/tax-profile", { cache: "no-store" })
        .then(async (response) => response.ok ? response.json() : null)
        .then((payload) => {
          const profile = payload?.profile;
          if (!profile) return;
          setTaxEnabled(true); setTaxLegalName(profile.legal_name ?? "");
          setTaxActivity(profile.business_activity ?? ""); setTaxAddress(profile.tax_address ?? "");
          setTaxCommune(profile.tax_commune ?? ""); setTaxCity(profile.tax_city ?? "");
          setTaxEmail(profile.tax_email ?? "");
        }).catch(() => undefined);
    }
  }, [open, initial]);

  // ✅ Cerrar con ESC / Guardar con Enter
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();

      if (e.key === "Enter") {
        e.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fullName, phone, email, customerRut, tenantId, initial, onClose]);

  const phoneNormalized = useMemo(() => normalizeCLPhone(phone), [phone]);

  const canSave = useMemo(() => {
    if (fullName.trim().length < 2) return false;
    if (phoneNormalized.length < 9) return false;
    if (!validateRut(customerRut)) return false;
    if (taxEnabled && (taxLegalName.trim().length < 2 || taxActivity.trim().length < 2 || taxAddress.trim().length < 2 || taxCommune.trim().length < 2 || taxCity.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(taxEmail))) return false;
    return true;
  }, [customerRut, fullName, phoneNormalized, taxActivity, taxAddress, taxCity, taxCommune, taxEmail, taxEnabled, taxLegalName]);

  const handleSave = async () => {
    if (!canSave || saving) return;

    setSaving(true);

    try {
      // ✅ obtener token para Authorization (Bearer)
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      if (!token) {
        toast({ title: "Sesion expirada", description: "Vuelve a iniciar sesion.", variant: "destructive" });
        setSaving(false);
        return;
      }

      const res = await adminFetch("/api/customers/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantId,
          customerId: isEdit ? initial!.id : null, // 👈 si viene, hace UPDATE
          name: fullName.trim(), // endpoint recibe "name" y lo guarda en full_name
          phone: phoneNormalized,
          email: email.trim() ? email.trim() : null,
          customerRut: normalizeRut(customerRut),
        }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        console.error("Error upsert customer (API):", json);
        toast({
          title: isEdit ? "Error editando cliente" : "Error creando cliente",
          description: json?.error,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      const reused = !!json?.reused;
      if (taxEnabled) {
        const taxResponse = await adminFetch("/api/admin/customers/" + json.customerId + "/tax-profile", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerRut, profile: {
            rut: customerRut, legalName: taxLegalName, businessActivity: taxActivity,
            address: taxAddress, commune: taxCommune, city: taxCity, taxEmail,
          } }),
        });
        if (!taxResponse.ok) throw new Error("No se pudo guardar el perfil tributario");
      }

      // ✅ Aviso UX (puedes cambiarlo por toast)
      if (!isEdit && reused) {
        toast({
          title: "Cliente reutilizado",
          description: "Este cliente ya existia con el mismo telefono o email.",
        });
      }

      // ✅ Devolver solo id + reused (la lista se refresca afuera)
      onSaved({ id: json.customerId as string, reused });

      setSaving(false);
      onClose();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Error inesperado";
      toast({
        title: isEdit ? "Error editando cliente" : "Error creando cliente",
        description: message,
        variant: "destructive",
      });
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 800 }}>
              {isEdit ? "Editar cliente" : "Nuevo cliente"}
            </div>
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
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
              Nombre *
            </div>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: Juan Pérez"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
              Teléfono (WhatsApp) *
            </div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 9 1234 5678"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
              Email (opcional)
            </div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ej: cliente@email.com"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>RUT *</div>
            <input
              value={customerRut}
              onChange={(event) => setCustomerRut(event.target.value)}
              onBlur={() => { if (validateRut(customerRut)) setCustomerRut(normalizeRut(customerRut)); }}
              placeholder="Ej: 12.345.678-5"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid" }}
            />
            {customerRut.trim() && !validateRut(customerRut) ? <div style={{ color: "red", fontSize: 12 }}>RUT inválido</div> : null}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <input type="checkbox" checked={taxEnabled} onChange={(event) => setTaxEnabled(event.target.checked)} />
            Crear o editar datos tributarios
          </label>
          {taxEnabled ? (
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              {[
                ["Razón social", taxLegalName, setTaxLegalName],
                ["Giro", taxActivity, setTaxActivity],
                ["Dirección tributaria", taxAddress, setTaxAddress],
                ["Comuna", taxCommune, setTaxCommune],
                ["Ciudad", taxCity, setTaxCity],
                ["Email tributario", taxEmail, setTaxEmail],
              ].map(([label, value, setter]) => (
                <label key={String(label)} style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  {String(label)}
                  <input value={String(value)} onChange={(event) => (setter as (value: string) => void)(event.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid" }} />
                </label>
              ))}
            </div>
          ) : null}

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
