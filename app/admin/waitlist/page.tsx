"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  EmptyState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { toast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type WaitlistStatus = "active" | "notified" | "booked" | "expired" | "deleted";

type WaitlistRow = {
  id: string;
  tenant_id: string;
  service_id: string;
  professional_id: string | null;
  service_name: string | null;
  date: string;
  time: string;
  desired_from_at: string | null;
  desired_to_at: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  notes: string | null;
  source: string | null;
  status: WaitlistStatus;
  notified_at: string | null;
  created_at: string;
};

const STATUS_OPTIONS: Array<{ value: WaitlistStatus | "all"; label: string }> = [
  { value: "active", label: "Pendientes" },
  { value: "notified", label: "Notificadas" },
  { value: "booked", label: "Convertidas" },
  { value: "expired", label: "Cerradas" },
  { value: "all", label: "Todas" },
];

const STATUS_LABEL: Record<WaitlistStatus, string> = {
  active: "Pendiente",
  notified: "Notificado",
  booked: "Convertido",
  expired: "Cerrado",
  deleted: "Cerrado",
};

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";
  return date.toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(value?: string | null) {
  if (!value) return "Flexible";
  return value.slice(0, 5) === "00:00" ? "Flexible" : value.slice(0, 5);
}

function statusTone(status: WaitlistStatus): "slate" | "green" | "amber" | "blue" {
  if (status === "active") return "amber";
  if (status === "notified") return "blue";
  if (status === "booked") return "green";
  if (status === "expired") return "slate";
  return "slate";
}

export default function AdminWaitlistPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WaitlistRow[]>([]);
  const [status, setStatus] = useState<WaitlistStatus | "all">("active");
  const [query, setQuery] = useState("");
  const [actionId, setActionId] = useState("");

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  };

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setTenantError("Este panel debe abrirse desde el subdominio del cliente.");
        setLoading(false);
        return;
      }
      setTenantSlug(slug);

      const { data, error } = await supabase
        .from("tenants")
        .select("id, slug")
        .eq("slug", slug)
        .maybeSingle();

      if (error || !data?.id) {
        setTenantError(error?.message ?? `No existe tenant para ${slug}`);
        setLoading(false);
        return;
      }

      setTenantId(data.id);
    };

    void run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!tenantId || tenantError) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?redirectTo=${encodeURIComponent("/admin/waitlist")}`);
        return;
      }
      setAuthChecked(true);
    };
    void run();
  }, [router, tenantId, tenantError]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);

    const token = await getToken();
    if (!token) {
      setItems([]);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({ tenantId, status });
    const res = await fetch(`/api/admin/waitlist?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (res.status === 401) {
      router.push(`/login?redirectTo=${encodeURIComponent("/admin/waitlist")}`);
      setLoading(false);
      return;
    }

    if (!res.ok || !json?.ok) {
      console.error("[admin/waitlist] load error:", json);
      setItems([]);
    } else {
      setItems((json.items ?? []) as WaitlistRow[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!authChecked || !tenantId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, tenantId, status]);

  const updateStatus = async (id: string, nextStatus: WaitlistStatus) => {
    if (!tenantId) return;
    setActionId(id);
    const token = await getToken();
    const res = await fetch(`/api/admin/waitlist/${id}?tenantId=${tenantId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: nextStatus }),
    });

    setActionId("");
    if (!res.ok) {
      toast({ title: "No se pudo actualizar la solicitud", variant: "destructive" });
      return;
    }

    await load();
  };

  const remove = async (id: string) => {
    if (!tenantId) return;
    const ok = window.confirm("¿Eliminar esta solicitud de lista de espera?");
    if (!ok) return;

    setActionId(id);
    const token = await getToken();
    const res = await fetch(`/api/admin/waitlist/${id}?tenantId=${tenantId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    setActionId("");
    if (!res.ok) {
      toast({ title: "No se pudo eliminar la solicitud", variant: "destructive" });
      return;
    }

    await load();
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;

    return items.filter((item) =>
      [
        item.customer_name,
        item.customer_email,
        item.customer_phone,
        item.service_name,
        item.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  const kpis = useMemo(
    () => ({
      pending: items.filter((item) => item.status === "active").length,
      notified: items.filter((item) => item.status === "notified").length,
      converted: items.filter((item) => item.status === "booked").length,
      closed: items.filter((item) => item.status === "expired").length,
    }),
    [items],
  );

  if (tenantError) {
    return <main className="p-6 text-sm text-red-700">{tenantError}</main>;
  }

  return (
    <AdminPageShell width="normal">
        <AdminNav />

        <AdminPageHeader
          eyebrow="Demanda no capturada"
          title="Waitlist"
          description={`Solicitudes de cupos para ${tenantSlug || "..."}, listas para contactar o convertir en reserva.`}
          actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !authChecked}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "Cargando..." : "Recargar"}
          </button>
          }
        />

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdminKpiCard label="Pendientes" value={kpis.pending} tone="amber" />
          <AdminKpiCard label="Notificados" value={kpis.notified} tone="blue" />
          <AdminKpiCard label="Convertidos" value={kpis.converted} tone="green" />
          <AdminKpiCard label="Cerrados" value={kpis.closed} />
        </div>

        <AdminSectionCard className="mt-5" title="Solicitudes" description="No se cambia el webhook actual a n8n; solo se ordena el trabajo operativo.">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  className={`h-9 rounded-xl border px-3 text-sm font-bold ${
                    status === option.value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-slate-400 lg:max-w-xs"
              placeholder="Buscar por nombre, email o servicio"
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[980px] w-full border-separate border-spacing-y-2 text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Servicio</th>
                  <th className="px-3 py-2">Horario deseado</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Creado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading || !authChecked ? (
                  <tr>
                    <td colSpan={6} className="rounded-xl bg-slate-50 px-3 py-6 text-center text-slate-500">
                      Cargando solicitudes...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="rounded-xl px-3 py-4">
                      <EmptyState
                        title="No hay solicitudes para este filtro"
                        description="Cuando una persona solicite un horario no disponible, aparecerá aquí con servicio, contacto y flexibilidad."
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id} className="bg-slate-50/80">
                      <td className="rounded-l-xl px-3 py-3 align-top">
                        <div className="font-black text-slate-950">{item.customer_name}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.customer_email}</div>
                        <div className="text-xs text-slate-500">{item.customer_phone || "Sin teléfono"}</div>
                        {item.notes ? (
                          <div className="mt-2 max-w-xs text-xs text-slate-500">{item.notes}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-bold text-slate-800">
                          {item.service_name || "Servicio no disponible"}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">{item.source || "booking_flow"}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-bold text-slate-800">
                          {formatDate(item.date)} · {formatTime(item.time)}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          Flexibilidad: {item.desired_from_at || item.desired_to_at ? "rango sugerido" : "horario puntual"}
                        </div>
                        {item.desired_from_at || item.desired_to_at ? (
                          <div className="mt-1 text-xs text-slate-500">
                            Rango: {formatDateTime(item.desired_from_at)} a {formatDateTime(item.desired_to_at)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <StatusBadge tone={statusTone(item.status)}>
                          {STATUS_LABEL[item.status]}
                        </StatusBadge>
                        {item.notified_at ? (
                          <div className="mt-1 text-xs text-slate-400">
                            {formatDateTime(item.notified_at)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-slate-500">
                        {formatDateTime(item.created_at)}
                      </td>
                      <td className="rounded-r-xl px-3 py-3 align-top">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => updateStatus(item.id, "notified")}
                            disabled={actionId === item.id}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Contactar
                          </button>
                          <button
                            type="button"
                            onClick={() => updateStatus(item.id, "booked")}
                            disabled={actionId === item.id}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Convertir
                          </button>
                          <button
                            type="button"
                            onClick={() => updateStatus(item.id, "expired")}
                            disabled={actionId === item.id}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Cerrar
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(item.id)}
                            disabled={actionId === item.id}
                            className="rounded-lg border border-red-100 bg-white px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </AdminSectionCard>
    </AdminPageShell>
  );
}
