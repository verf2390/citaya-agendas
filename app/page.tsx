"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
};

type Appointment = {
  id: string;
  tenant_id: string;
  professional_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  start_at: string;
  end_at: string;
  status: string;
  notes: string | null;
  created_at: string;
};

const TENANT_ID = "04d6c088-338d-44b2-b27b-b4709f48d31b"; // <- pega aquí el id real

export default function Home() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      // 1) Traer tenants
      const { data: tenantsData, error: tenantsError } = await supabase
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: true });

      if (tenantsError) console.error("tenantsError:", tenantsError);
      setTenants(tenantsData ?? []);

      // 2) Traer appointments del tenant fajaspaola
      const { data: apptData, error: apptError } = await supabase
        .from("appointments")
        .select("*")
        .eq("tenant_id", TENANT_ID)
        .order("start_at", { ascending: true });

      if (apptError) console.error("apptError:", apptError);
      setAppointments(apptData ?? []);

      setLoading(false);
    };

    load();
  }, []);

  return (
    <main style={{ padding: 30, fontFamily: "system-ui" }}>
      <h1>Citaya Agendas ✅</h1>

      {loading ? (
        <p>Cargando...</p>
      ) : (
        <>
          <h2>Tenants encontrados:</h2>
          <pre>{JSON.stringify(tenants, null, 2)}</pre>

          <hr style={{ margin: "24px 0" }} />

          <h2>Citas (appointments) del tenant:</h2>

          {appointments.length === 0 ? (
            <p>No hay citas aún para este tenant.</p>
          ) : (
            <ul>
              {appointments.map((a) => (
                <li key={a.id} style={{ marginBottom: 10 }}>
                  <b>{a.customer_name}</b>{" "}
                  <span style={{ color: "#555" }}>
                    ({a.status}) — {new Date(a.start_at).toLocaleString()} →{" "}
                    {new Date(a.end_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
