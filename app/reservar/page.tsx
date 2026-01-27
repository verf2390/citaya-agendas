"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const PROFESSIONALS = [
  { id: "f0e085dd-22ff-4c43-98bd-41eeaf9f4861", name: "Paola" },
  { id: "f143d73b-7ede-46a1-b288-76740224d679", name: "Gabriela" },
];

type Slot = { start_at: string; end_at: string };

function formatCL(dateISO: string) {
  const d = new Date(dateISO);
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function onlyTimeCL(dateISO: string) {
  const d = new Date(dateISO);
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(d);
}

function dayLabelCL(dateISO: string) {
  const d = new Date(dateISO);
  return new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "2-digit", month: "short" }).format(d);
}

function normalizeCLPhone(input: string) {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.length === 9 && digits.startsWith("9")) return `+56${digits}`;

  return digits ? `+${digits}` : trimmed;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function whatsappLink(phoneE164: string, message: string) {
  const cleaned = phoneE164.replace(/[^\d+]/g, "");
  const text = encodeURIComponent(message);
  return `https://wa.me/${cleaned}?text=${text}`;
}

/** ✅ Importante: useSearchParams() vive aquí adentro */
function ReservarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // viene desde el botón "Reservar"
  const tenantSlug = searchParams.get("tenant") || "";
  const serviceId = searchParams.get("service") || "";

  const [tenantId, setTenantId] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");

  const [daysAhead, setDaysAhead] = useState<number>(31);

  const [professionalId, setProfessionalId] = useState(PROFESSIONALS[0]?.id ?? "");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const phoneNorm = useMemo(() => normalizeCLPhone(phone), [phone]);

  // 1) Cargar tenantId por slug
  useEffect(() => {
    if (!tenantSlug) {
      setTenantId("");
      setTenantName("");
      setLoadError("Falta tenant en la URL (query param).");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoadError(null);

        const res = await fetch(`/api/tenants/by-slug?slug=${encodeURIComponent(tenantSlug)}`, { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) throw new Error(json?.error ?? "No se pudo cargar tenant");

        if (!cancelled) {
          setTenantId(json?.tenant?.id ?? "");
          setTenantName(json?.tenant?.name ?? "");
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setTenantId("");
          setTenantName("");
          setLoadError(e?.message ?? "No se pudo cargar tenant");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);
    to.setDate(to.getDate() + daysAhead);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [daysAhead]);

  const professionalName = useMemo(() => {
    return PROFESSIONALS.find((p) => p.id === professionalId)?.name ?? "Profesional";
  }, [professionalId]);

  const availabilityUrl = useMemo(() => {
    if (!tenantId || !professionalId) return "";
    return `/api/appointments/availability?tenantId=${encodeURIComponent(tenantId)}&professionalId=${encodeURIComponent(
      professionalId
    )}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  }, [tenantId, professionalId, range.from, range.to]);

  const loadSlots = async () => {
    if (!tenantId) return;
    if (!professionalId) return;
    if (!availabilityUrl) return;

    setLoadingSlots(true);
    setLoadError(null);
    setSelectedSlot(null);

    try {
      const res = await fetch(availabilityUrl, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Error cargando slots");

      setSlots(Array.isArray(json.slots) ? json.slots : []);
    } catch (e: any) {
      console.error(e);
      setSlots([]);
      setLoadError(e?.message ?? "No se pudo cargar disponibilidad");
    } finally {
      setLoadingSlots(false);
    }
  };

  // 2) Cargar slots SOLO cuando ya tenemos tenantId
  useEffect(() => {
    if (!tenantId) return;
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, availabilityUrl, professionalId]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();

    for (const s of slots) {
      const d = new Date(s.start_at);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }

    const keys = Array.from(map.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return keys.map((k) => {
      const daySlots = map.get(k)!;
      daySlots.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      return { dayKey: k, label: dayLabelCL(k), slots: daySlots };
    });
  }, [slots]);

  const canSubmit =
    !!selectedSlot &&
    !!tenantId &&
    fullName.trim().length >= 2 &&
    phoneNorm.trim().length >= 10 &&
    isValidEmail(email) &&
    !saving;

  const handleReserve = async () => {
    if (!selectedSlot) return;
    if (!tenantId) {
      alert("No se pudo identificar el tenant.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        tenant_id: tenantId,
        professional_id: professionalId,
        customer_name: fullName.trim(),
        customer_phone: phoneNorm.trim(),
        customer_email: email.trim(),
        start_at: selectedSlot.start_at,
        end_at: selectedSlot.end_at,
        status: "confirmed",
        // opcional (por si luego lo usas)
        service_id: serviceId || null,
      };

      const res = await fetch("/api/appointments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "No se pudo crear la cita");

      const msg = `Hola! Soy ${fullName}. Reservé una hora para ${formatCL(selectedSlot.start_at)} con ${professionalName}.`;
      const wa = whatsappLink(phoneNorm, msg);

      const qs = new URLSearchParams({
        start: selectedSlot.start_at,
        prof: professionalName,
        wa,
        email: email.trim(),
        phone: phoneNorm.trim(),
      }).toString();

      router.push(`/reservar/confirmacion?${qs}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Error reservando");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      {/* Debug mínimo */}
      <div style={{ marginBottom: 10, padding: 10, border: "1px dashed #ddd", borderRadius: 12 }}>
        <div>
          <b>tenant</b>: {tenantSlug || "—"} {tenantName ? `(${tenantName})` : ""}
        </div>
        <div>
          <b>tenantId</b>: {tenantId || "—"}
        </div>
        <div>
          <b>service</b>: {serviceId || "—"}
        </div>
      </div>

      <h1 style={{ marginBottom: 6 }}>Reservar hora</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>Selecciona un profesional, elige un horario y confirma tu reserva.</p>

      {/* PROFESIONAL */}
      <section style={{ marginTop: 14, padding: 16, border: "1px solid #e5e5e5", borderRadius: 12 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>Profesional</label>

        <select
          value={professionalId}
          disabled={saving || !tenantId}
          onChange={(e) => setProfessionalId(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
        >
          {PROFESSIONALS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </section>

      {/* DISPONIBILIDAD */}
      <section style={{ marginTop: 14, padding: 16, border: "1px solid #e5e5e5", borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Horarios disponibles ({daysAhead} días)</h2>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ fontWeight: 700, opacity: 0.9 }}>Ver:</label>
            <select
              value={daysAhead}
              disabled={saving || loadingSlots || !tenantId}
              onChange={(e) => setDaysAhead(Number(e.target.value))}
              style={{ padding: 8, borderRadius: 10, border: "1px solid #ccc" }}
            >
              <option value={7}>7 días</option>
              <option value={14}>14 días</option>
              <option value={31}>31 días</option>
            </select>

            <button
              onClick={loadSlots}
              disabled={saving || loadingSlots || !tenantId}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "#fff",
                cursor: saving || loadingSlots || !tenantId ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {loadingSlots ? "Cargando..." : "Recargar"}
            </button>
          </div>
        </div>

        {loadError && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid #ffd2d2", background: "#fff5f5", color: "#a40000" }}>
            {loadError}
          </div>
        )}

        {!loadingSlots && !loadError && grouped.length === 0 && (
          <p style={{ marginTop: 12, opacity: 0.75 }}>No hay horarios disponibles en este rango.</p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 12 }}>
          {grouped.map((g) => (
            <div key={g.dayKey} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 10, textTransform: "capitalize" }}>{g.label}</div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {g.slots.map((s) => {
                  const active = selectedSlot?.start_at === s.start_at;

                  return (
                    <button
                      key={s.start_at}
                      disabled={saving || !tenantId}
                      onClick={() => setSelectedSlot(s)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: active ? "2px solid #111" : "1px solid #ccc",
                        background: active ? "#111" : "#fff",
                        color: active ? "#fff" : "#111",
                        cursor: saving || !tenantId ? "not-allowed" : "pointer",
                        opacity: saving || !tenantId ? 0.6 : 1,
                        fontWeight: 700,
                      }}
                    >
                      {onlyTimeCL(s.start_at)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 12, opacity: 0.75 }}>
          <b>Horario elegido:</b>{" "}
          {selectedSlot ? `${formatCL(selectedSlot.start_at)} (${professionalName})` : "Aún no seleccionas uno"}
        </p>
      </section>

      {/* DATOS CLIENTE */}
      <section style={{ marginTop: 14, padding: 16, border: "1px solid #e5e5e5", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Tus datos</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>Nombre</label>
            <input
              value={fullName}
              disabled={saving || !tenantId}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: Juan Pérez"
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>Celular</label>
            <input
              value={phone}
              disabled={saving || !tenantId}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 912345678 o +56912345678"
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
            <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12 }}>
              Se guardará como: <b>{phoneNorm || "—"}</b>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>Correo</label>
          <input
            value={email}
            disabled={saving || !tenantId}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Ej: nombre@gmail.com"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
          {!isValidEmail(email) && email.trim().length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "crimson" }}>Correo inválido (MVP).</div>
          )}
        </div>

        <button
          onClick={handleReserve}
          disabled={!canSubmit}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: "none",
            background: canSubmit ? "#111" : "#999",
            color: "#fff",
            cursor: canSubmit ? "pointer" : "not-allowed",
            fontWeight: 800,
          }}
        >
          {saving ? "Reservando..." : "Reservar ahora"}
        </button>
      </section>
    </main>
  );
}

export default function ReservarPage() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
          Cargando…
        </main>
      }
    >
      <ReservarInner />
    </Suspense>
  );
}
