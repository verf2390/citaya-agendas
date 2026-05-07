"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  FileText,
  Landmark,
  ReceiptText,
  Save,
  ShieldCheck,
} from "lucide-react";
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

type DocumentType = "boleta" | "factura" | "exenta";
type BillingProvider = "none" | "manual_sii" | "api_provider";
type ProviderStatus = "not_configured" | "pending" | "connected" | "error";

type BillingSettings = {
  tenantId: string;
  legalName: string;
  taxId: string;
  businessActivity: string;
  taxAddress: string;
  taxCommune: string;
  taxCity: string;
  taxEmail: string;
  taxPhone: string;
  defaultDocumentType: DocumentType;
  provider: BillingProvider;
  providerStatus: ProviderStatus;
  autoIssueOnPaid: boolean;
  allowInvoiceRequest: boolean;
};

const DEFAULT_SETTINGS: BillingSettings = {
  tenantId: "",
  legalName: "",
  taxId: "",
  businessActivity: "",
  taxAddress: "",
  taxCommune: "",
  taxCity: "",
  taxEmail: "",
  taxPhone: "",
  defaultDocumentType: "boleta",
  provider: "none",
  providerStatus: "not_configured",
  autoIssueOnPaid: false,
  allowInvoiceRequest: true,
};

const providerOptions: Array<{
  id: BillingProvider;
  title: string;
  text: string;
  icon: typeof FileText;
}> = [
  {
    id: "none",
    title: "Sin proveedor conectado",
    text: "Deja los datos listos sin activar emisión automática.",
    icon: FileText,
  },
  {
    id: "manual_sii",
    title: "SII manual / gratuito",
    text: "Referencia operativa para procesos manuales mientras se conecta API.",
    icon: Landmark,
  },
  {
    id: "api_provider",
    title: "Proveedor externo / API",
    text: "Preparado para conectar un proveedor DTE en una etapa posterior.",
    icon: ShieldCheck,
  },
];

const CHILE_REGIONS = [
  {
    name: "Región de Arica y Parinacota",
    communes: ["Arica", "Camarones", "Putre", "General Lagos"],
  },
  {
    name: "Región de Tarapacá",
    communes: [
      "Iquique",
      "Alto Hospicio",
      "Pozo Almonte",
      "Camiña",
      "Colchane",
      "Huara",
      "Pica",
    ],
  },
  {
    name: "Región de Antofagasta",
    communes: [
      "Antofagasta",
      "Mejillones",
      "Sierra Gorda",
      "Taltal",
      "Calama",
      "Ollagüe",
      "San Pedro de Atacama",
      "Tocopilla",
      "María Elena",
    ],
  },
  {
    name: "Región de Atacama",
    communes: [
      "Copiapó",
      "Caldera",
      "Tierra Amarilla",
      "Chañaral",
      "Diego de Almagro",
      "Vallenar",
      "Alto del Carmen",
      "Freirina",
      "Huasco",
    ],
  },
  {
    name: "Región de Coquimbo",
    communes: [
      "La Serena",
      "Coquimbo",
      "Andacollo",
      "La Higuera",
      "Paiguano",
      "Vicuña",
      "Illapel",
      "Canela",
      "Los Vilos",
      "Salamanca",
      "Ovalle",
      "Combarbalá",
      "Monte Patria",
      "Punitaqui",
      "Río Hurtado",
    ],
  },
  {
    name: "Región de Valparaíso",
    communes: [
      "Valparaíso",
      "Viña del Mar",
      "Concón",
      "Quilpué",
      "Villa Alemana",
      "Quillota",
      "La Calera",
      "Los Andes",
      "San Felipe",
      "San Antonio",
      "Cartagena",
      "Casablanca",
      "Puchuncaví",
      "Zapallar",
      "Isla de Pascua",
    ],
  },
  {
    name: "Región Metropolitana de Santiago",
    communes: [
      "Santiago",
      "Cerrillos",
      "Cerro Navia",
      "Conchalí",
      "El Bosque",
      "Estación Central",
      "Huechuraba",
      "Independencia",
      "La Cisterna",
      "La Florida",
      "La Granja",
      "La Pintana",
      "La Reina",
      "Las Condes",
      "Lo Barnechea",
      "Lo Espejo",
      "Lo Prado",
      "Macul",
      "Maipú",
      "Ñuñoa",
      "Pedro Aguirre Cerda",
      "Peñalolén",
      "Providencia",
      "Pudahuel",
      "Quilicura",
      "Quinta Normal",
      "Recoleta",
      "Renca",
      "San Joaquín",
      "San Miguel",
      "San Ramón",
      "Vitacura",
      "Puente Alto",
      "Pirque",
      "San José de Maipo",
      "Colina",
      "Lampa",
      "Tiltil",
      "San Bernardo",
      "Buin",
      "Calera de Tango",
      "Paine",
      "Melipilla",
      "Talagante",
      "Peñaflor",
      "Padre Hurtado",
      "El Monte",
      "Isla de Maipo",
    ],
  },
  {
    name: "Región del Libertador General Bernardo O'Higgins",
    communes: [
      "Rancagua",
      "Machalí",
      "Graneros",
      "Mostazal",
      "Rengo",
      "Requínoa",
      "San Fernando",
      "Chimbarongo",
      "Santa Cruz",
      "Pichilemu",
      "Litueche",
    ],
  },
  {
    name: "Región del Maule",
    communes: [
      "Talca",
      "Curicó",
      "Linares",
      "Constitución",
      "Molina",
      "Parral",
      "Cauquenes",
      "San Javier",
      "Teno",
      "Longaví",
    ],
  },
  {
    name: "Región de Ñuble",
    communes: [
      "Chillán",
      "Chillán Viejo",
      "Bulnes",
      "Quillón",
      "San Carlos",
      "Coihueco",
      "Yungay",
      "Quirihue",
      "Cobquecura",
    ],
  },
  {
    name: "Región del Biobío",
    communes: [
      "Concepción",
      "Talcahuano",
      "Hualpén",
      "San Pedro de la Paz",
      "Chiguayante",
      "Coronel",
      "Lota",
      "Los Ángeles",
      "Nacimiento",
      "Cabrero",
      "Arauco",
      "Cañete",
    ],
  },
  {
    name: "Región de La Araucanía",
    communes: [
      "Temuco",
      "Padre Las Casas",
      "Villarrica",
      "Pucón",
      "Angol",
      "Victoria",
      "Lautaro",
      "Nueva Imperial",
      "Collipulli",
      "Traiguén",
    ],
  },
  {
    name: "Región de Los Ríos",
    communes: [
      "Valdivia",
      "Panguipulli",
      "La Unión",
      "Río Bueno",
      "Paillaco",
      "Lanco",
      "Mariquina",
      "Futrono",
    ],
  },
  {
    name: "Región de Los Lagos",
    communes: [
      "Puerto Montt",
      "Puerto Varas",
      "Osorno",
      "Castro",
      "Ancud",
      "Quellón",
      "Frutillar",
      "Llanquihue",
      "Calbuco",
      "Chaitén",
    ],
  },
  {
    name: "Región de Aysén del General Carlos Ibáñez del Campo",
    communes: [
      "Coyhaique",
      "Puerto Aysén",
      "Cisnes",
      "Chile Chico",
      "Cochrane",
      "Río Ibáñez",
      "Tortel",
    ],
  },
  {
    name: "Región de Magallanes y de la Antártica Chilena",
    communes: [
      "Punta Arenas",
      "Puerto Natales",
      "Porvenir",
      "Cabo de Hornos",
      "Torres del Paine",
    ],
  },
] as const;

function normalizeLocation(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findRegionByName(value: string) {
  const normalizedValue = normalizeLocation(value);
  if (!normalizedValue) return null;
  return (
    CHILE_REGIONS.find((region) => normalizeLocation(region.name) === normalizedValue) ??
    null
  );
}

function findRegionByCommune(value: string) {
  const normalizedValue = normalizeLocation(value);
  if (!normalizedValue) return null;
  return (
    CHILE_REGIONS.find((region) =>
      region.communes.some((commune) => normalizeLocation(commune) === normalizedValue),
    ) ?? null
  );
}

function inferRegionName(taxCity: string, taxCommune: string) {
  return (
    findRegionByName(taxCity)?.name ??
    findRegionByCommune(taxCity)?.name ??
    findRegionByCommune(taxCommune)?.name ??
    taxCity
  );
}

function providerStatusLabel(status: ProviderStatus) {
  if (status === "pending") return "Pendiente";
  if (status === "connected") return "Conectado";
  if (status === "error") return "Error";
  return "No configurado";
}

function providerStatusTone(status: ProviderStatus) {
  if (status === "connected") return "green";
  if (status === "pending") return "amber";
  if (status === "error") return "red";
  return "slate";
}

function normalizeSettings(input: any, tenantId: string): BillingSettings {
  const taxCommune = String(input?.taxCommune ?? "");
  const taxCity = inferRegionName(String(input?.taxCity ?? ""), taxCommune);

  return {
    tenantId,
    legalName: String(input?.legalName ?? ""),
    taxId: String(input?.taxId ?? ""),
    businessActivity: String(input?.businessActivity ?? ""),
    taxAddress: String(input?.taxAddress ?? ""),
    taxCommune,
    taxCity,
    taxEmail: String(input?.taxEmail ?? ""),
    taxPhone: String(input?.taxPhone ?? ""),
    defaultDocumentType:
      input?.defaultDocumentType === "factura" ||
      input?.defaultDocumentType === "exenta"
        ? input.defaultDocumentType
        : "boleta",
    provider:
      input?.provider === "manual_sii" || input?.provider === "api_provider"
        ? input.provider
        : "none",
    providerStatus:
      input?.providerStatus === "pending" ||
      input?.providerStatus === "connected" ||
      input?.providerStatus === "error"
        ? input.providerStatus
        : "not_configured",
    autoIssueOnPaid: Boolean(input?.autoIssueOnPaid),
    allowInvoiceRequest:
      typeof input?.allowInvoiceRequest === "boolean"
        ? input.allowInvoiceRequest
        : true,
  };
}

export default function AdminFacturacionPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantError, setTenantError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaHint, setSchemaHint] = useState("");
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const run = async () => {
      const slug = getTenantSlugFromHostname(window.location.hostname);
      if (!slug) {
        setTenantError("Este panel debe abrirse desde el subdominio del cliente.");
        setLoading(false);
        return;
      }
      setTenantSlug(slug);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        router.push(`/login?redirectTo=${encodeURIComponent("/admin/facturacion")}`);
        return;
      }
      setAuthChecked(true);

      const { data: tenant, error } = await supabase
        .from("tenants")
        .select("id, slug")
        .eq("slug", slug)
        .maybeSingle();

      if (error || !tenant?.id) {
        setTenantError(error?.message ?? `No existe tenant para ${slug}`);
        setLoading(false);
        return;
      }

      setTenantId(tenant.id);

      const res = await fetch(
        `/api/admin/billing-settings?tenantId=${encodeURIComponent(tenant.id)}&tenantSlug=${encodeURIComponent(slug)}`,
        {
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
          cache: "no-store",
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setSchemaHint(json?.schemaHint ?? "");
        setTenantError(json?.error ?? "No se pudo cargar facturación.");
        setLoading(false);
        return;
      }

      setSettings(normalizeSettings(json.settings, tenant.id));
      setLoading(false);
    };

    void run();
  }, [router]);

  const statusTone = providerStatusTone(settings.providerStatus);
  const hasTaxIdentity = Boolean(settings.legalName.trim() && settings.taxId.trim());
  const autoModeLabel = settings.autoIssueOnPaid
    ? "Automática al pago aprobado"
    : "Manual o sin emisión automática";
  const selectedRegion = findRegionByName(settings.taxCity);
  const selectedCommunes = selectedRegion?.communes ?? [];

  const roadmap = useMemo(
    () => [
      "Boletas automáticas al confirmar pago",
      "Facturas desde ficha de cliente",
      "Notas de crédito",
      "Envío automático por email",
      "Historial tributario por cliente",
    ],
    [],
  );

  const save = async () => {
    if (!tenantId || saving) return;

    setSaving(true);
    setSchemaHint("");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSaving(false);
      router.push(`/login?redirectTo=${encodeURIComponent("/admin/facturacion")}`);
      return;
    }

    const res = await fetch("/api/admin/billing-settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...settings, tenantId, tenantSlug }),
    });
    const json = await res.json().catch(() => null);

    setSaving(false);

    if (!res.ok || !json?.ok) {
      setSchemaHint(json?.schemaHint ?? "");
      toast({
        title: "No se pudo guardar facturación",
        description: json?.error ?? "Revisa la configuración e intenta nuevamente.",
        variant: "destructive",
      });
      return;
    }

    setSettings(normalizeSettings(json.settings, tenantId));
    toast({ title: "Facturación guardada" });
  };

  if (tenantError) {
    return (
      <AdminPageShell width="normal">
        <AdminNav />
        <EmptyState
          icon={AlertCircle}
          title="No se pudo cargar facturación"
          description={
            schemaHint ? `${tenantError} ${schemaHint}` : tenantError
          }
          actionLabel="Volver a integraciones"
          actionHref="/admin/integraciones"
        />
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell width="wide">
      <AdminNav />
      <AdminPageHeader
        eyebrow="Tributario"
        title="Facturación electrónica"
        description="Prepara la emisión de boletas y facturas para tus pagos y reservas."
        actions={
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || !authChecked}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Guardando..." : "Guardar facturación"}
          </button>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard
          label="Estado"
          value={providerStatusLabel(settings.providerStatus)}
          hint="Proveedor DTE/API"
          tone={statusTone === "green" ? "green" : statusTone === "red" ? "red" : "amber"}
        />
        <AdminKpiCard
          label="Documento"
          value={settings.defaultDocumentType}
          hint="Tipo por defecto"
          tone="blue"
        />
        <AdminKpiCard
          label="Emisión"
          value={settings.autoIssueOnPaid ? "Auto" : "Manual"}
          hint={autoModeLabel}
        />
        <AdminKpiCard
          label="Datos"
          value={hasTaxIdentity ? "Listos" : "Pendientes"}
          hint="Razón social y RUT"
          tone={hasTaxIdentity ? "green" : "amber"}
        />
      </div>

      {loading ? (
        <AdminSectionCard className="mt-5">
          <div className="text-sm font-bold text-slate-500">
            Cargando configuración tributaria...
          </div>
        </AdminSectionCard>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4">
            <AdminSectionCard
              title="Estado de integración"
              description="Citaya deja preparada la configuración tributaria sin emitir documentos todavía."
              actions={
                <StatusBadge
                  label={providerStatusLabel(settings.providerStatus)}
                  tone={statusTone}
                />
              }
            >
              <div className="grid gap-4">
                <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm font-bold leading-6 text-sky-900">
                  Esta sección prepara Citaya para emitir boletas y facturas electrónicas.
                  La conexión automática al SII se realizará mediante proveedor DTE/API en
                  una etapa posterior.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    Estado de integración
                    <select
                      value={settings.providerStatus}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          providerStatus: e.target.value as ProviderStatus,
                        }))
                      }
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-semibold outline-none focus:border-slate-400"
                    >
                      <option value="not_configured">No configurado</option>
                      <option value="pending">Pendiente</option>
                      <option value="connected">Conectado</option>
                      <option value="error">Error</option>
                    </select>
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-black uppercase text-slate-500">
                      Próximo paso
                    </div>
                    <div className="mt-1 text-sm font-bold text-slate-800">
                      Configurar datos tributarios y proveedor DTE.
                    </div>
                  </div>
                </div>
              </div>
            </AdminSectionCard>

            <AdminSectionCard
              title="Datos tributarios"
              description="Información base del emisor para boletas y facturas."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-bold text-slate-700 sm:col-span-2">
                  Razón social
                  <input
                    value={settings.legalName}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, legalName: e.target.value }))
                    }
                    className="h-10 rounded-xl border border-slate-200 px-3 font-semibold outline-none focus:border-slate-400"
                    placeholder="Ej: Centro Psicológico Armonía SpA"
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  RUT empresa
                  <input
                    value={settings.taxId}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, taxId: e.target.value }))
                    }
                    className="h-10 rounded-xl border border-slate-200 px-3 font-semibold outline-none focus:border-slate-400"
                    placeholder="76.123.456-7"
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Giro
                  <input
                    value={settings.businessActivity}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        businessActivity: e.target.value,
                      }))
                    }
                    className="h-10 rounded-xl border border-slate-200 px-3 font-semibold outline-none focus:border-slate-400"
                    placeholder="Servicios profesionales"
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700 sm:col-span-2">
                  Dirección tributaria
                  <input
                    value={settings.taxAddress}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, taxAddress: e.target.value }))
                    }
                    className="h-10 rounded-xl border border-slate-200 px-3 font-semibold outline-none focus:border-slate-400"
                    placeholder="Calle, número, oficina"
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Región
                  <select
                    value={selectedRegion?.name ?? ""}
                    onChange={(e) =>
                      setSettings((prev) => {
                        const nextRegion = findRegionByName(e.target.value);
                        const nextCommunes = nextRegion?.communes ?? [];
                        const previousCommuneIsValid = nextCommunes.some(
                          (commune) =>
                            normalizeLocation(commune) ===
                            normalizeLocation(prev.taxCommune),
                        );

                        return {
                          ...prev,
                          taxCity: nextRegion?.name ?? "",
                          taxCommune: previousCommuneIsValid ? prev.taxCommune : "",
                        };
                      })
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-semibold outline-none focus:border-slate-400"
                  >
                    <option value="">Selecciona una región</option>
                    {CHILE_REGIONS.map((region) => (
                      <option key={region.name} value={region.name}>
                        {region.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Comuna
                  <select
                    value={
                      selectedCommunes.some(
                        (commune) =>
                          normalizeLocation(commune) ===
                          normalizeLocation(settings.taxCommune),
                      )
                        ? settings.taxCommune
                        : ""
                    }
                    disabled={!selectedRegion}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, taxCommune: e.target.value }))
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-semibold outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    <option value="">
                      {selectedRegion
                        ? "Selecciona una comuna"
                        : "Selecciona una región primero"}
                    </option>
                    {selectedCommunes.map((commune) => (
                      <option key={commune} value={commune}>
                        {commune}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Email tributario
                  <input
                    value={settings.taxEmail}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, taxEmail: e.target.value }))
                    }
                    className="h-10 rounded-xl border border-slate-200 px-3 font-semibold outline-none focus:border-slate-400"
                    placeholder="facturacion@negocio.cl"
                    inputMode="email"
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Teléfono
                  <input
                    value={settings.taxPhone}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, taxPhone: e.target.value }))
                    }
                    className="h-10 rounded-xl border border-slate-200 px-3 font-semibold outline-none focus:border-slate-400"
                    placeholder="+56 9..."
                  />
                </label>
              </div>
            </AdminSectionCard>

            <AdminSectionCard
              title="Emisión de documentos"
              description="Define cómo se comportará Citaya cuando la emisión quede conectada."
            >
              <div className="grid gap-4">
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  Tipo de documento por defecto
                  <select
                    value={settings.defaultDocumentType}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        defaultDocumentType: e.target.value as DocumentType,
                      }))
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-semibold outline-none focus:border-slate-400"
                  >
                    <option value="boleta">Boleta</option>
                    <option value="factura">Factura</option>
                    <option value="exenta">Exenta</option>
                  </select>
                </label>

                <label className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <span>
                    <span className="block text-sm font-black text-slate-900">
                      Emitir documento automáticamente al pago aprobado
                    </span>
                    <span className="mt-1 block text-sm font-semibold text-slate-500">
                      Queda preparado para una etapa posterior; hoy no emite documentos.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autoIssueOnPaid}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        autoIssueOnPaid: e.target.checked,
                      }))
                    }
                    className="mt-1 h-5 w-5 rounded border-slate-300"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <span>
                    <span className="block text-sm font-black text-slate-900">
                      Solicitar datos tributarios al cliente cuando pida factura
                    </span>
                    <span className="mt-1 block text-sm font-semibold text-slate-500">
                      Permitirá capturar razón social, RUT y giro del receptor.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.allowInvoiceRequest}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        allowInvoiceRequest: e.target.checked,
                      }))
                    }
                    className="mt-1 h-5 w-5 rounded border-slate-300"
                  />
                </label>
              </div>
            </AdminSectionCard>
          </div>

          <div className="grid gap-4 content-start">
            <AdminSectionCard
              title="Proveedor DTE"
              description="Selector preparado para futura conexión."
            >
              <div className="grid gap-3">
                {providerOptions.map((option) => {
                  const Icon = option.icon;
                  const active = settings.provider === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setSettings((prev) => ({
                          ...prev,
                          provider: option.id,
                          providerStatus:
                            option.id === "none" ? "not_configured" : prev.providerStatus,
                        }))
                      }
                      className={`rounded-2xl border p-4 text-left transition ${
                        active
                          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                            active ? "bg-white/15" : "bg-slate-50"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span>
                          <span className="block text-sm font-black">{option.title}</span>
                          <span
                            className={`mt-1 block text-xs font-semibold leading-5 ${
                              active ? "text-slate-200" : "text-slate-500"
                            }`}
                          >
                            {option.text}
                          </span>
                        </span>
                      </div>
                    </button>
                  );
                })}
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-900">
                  La conexión automática se hará en una etapa posterior con un proveedor DTE/API.
                </div>
              </div>
            </AdminSectionCard>

            <AdminSectionCard title="Vista futura">
              <div className="grid gap-2">
                {roadmap.map((item) => (
                  <div key={item} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    {item}
                  </div>
                ))}
              </div>
            </AdminSectionCard>

            <AdminSectionCard title="Integración con pagos">
              <div className="grid gap-3 text-sm font-bold text-slate-600">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <ReceiptText className="h-4 w-4 text-slate-500" />
                  Emitir documento manual desde Pagos
                </div>
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <FileCheck2 className="h-4 w-4 text-slate-500" />
                  Asociar documento a pago o reserva
                </div>
              </div>
            </AdminSectionCard>
          </div>
        </div>
      )}
    </AdminPageShell>
  );
}
