"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Code2,
  Eraser,
  Eye,
  FileCheck2,
  FileDown,
  FileText,
  FlaskConical,
  Landmark,
  Loader2,
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
import { buildDtePdfLab } from "@/lib/dte/pdf/build-dte-pdf";
import { buildDtePrintHtml } from "@/lib/dte/pdf/build-dte-print-view";
import type { DteDocumentType } from "@/lib/dte/dte-types";
import { supabase } from "@/lib/supabaseClient";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type DocumentType = "boleta" | "factura" | "exenta";
type BillingProvider = "none" | "manual_sii" | "api_provider";
type ProviderStatus = "not_configured" | "pending" | "connected" | "error";

type DteLabResult = {
  xml: string;
  metadata: {
    tipoDte: string;
    folioDummy: number;
    rutEmisor: string;
    rutReceptor: string;
    montoTotal: number;
    modo: "lab";
    xsdStatus: "pending";
    firma: "mock";
    caf: "dummy";
    estadoSii: "simulated";
    advertencia: string;
    isProductionValid: false;
  };
  caf: {
    range: string;
    rangeFrom: number;
    rangeTo: number;
  };
  folio: {
    reservedFolio: number;
    reservationStatus: string;
    simulatedUsageStatus: string;
  };
  signature: {
    signatureId: string;
    xsdReference: string;
  };
  warnings: string[];
};

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

function labMetadataLabel(value: string) {
  if (value === "boleta_afecta") return "Boleta afecta";
  if (value === "factura_afecta") return "Factura afecta";
  return value;
}

function getRecordValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object") return undefined;
  return (input as Record<string, unknown>)[key];
}

function normalizeSettings(input: unknown, tenantId: string): BillingSettings {
  const taxCommune = String(getRecordValue(input, "taxCommune") ?? "");
  const taxCity = inferRegionName(
    String(getRecordValue(input, "taxCity") ?? ""),
    taxCommune,
  );
  const defaultDocumentType = getRecordValue(input, "defaultDocumentType");
  const provider = getRecordValue(input, "provider");
  const providerStatus = getRecordValue(input, "providerStatus");
  const allowInvoiceRequest = getRecordValue(input, "allowInvoiceRequest");

  return {
    tenantId,
    legalName: String(getRecordValue(input, "legalName") ?? ""),
    taxId: String(getRecordValue(input, "taxId") ?? ""),
    businessActivity: String(getRecordValue(input, "businessActivity") ?? ""),
    taxAddress: String(getRecordValue(input, "taxAddress") ?? ""),
    taxCommune,
    taxCity,
    taxEmail: String(getRecordValue(input, "taxEmail") ?? ""),
    taxPhone: String(getRecordValue(input, "taxPhone") ?? ""),
    defaultDocumentType:
      defaultDocumentType === "factura" || defaultDocumentType === "exenta"
        ? defaultDocumentType
        : "boleta",
    provider:
      provider === "manual_sii" || provider === "api_provider"
        ? provider
        : "none",
    providerStatus:
      providerStatus === "pending" ||
      providerStatus === "connected" ||
      providerStatus === "error"
        ? providerStatus
        : "not_configured",
    autoIssueOnPaid: Boolean(getRecordValue(input, "autoIssueOnPaid")),
    allowInvoiceRequest:
      typeof allowInvoiceRequest === "boolean"
        ? allowInvoiceRequest
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
  const [dteLabLoading, setDteLabLoading] = useState(false);
  const [dteLabResult, setDteLabResult] = useState<DteLabResult | null>(null);
  const [dteLabError, setDteLabError] = useState("");

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

  const generateDteLabXml = async () => {
    if (!tenantId || dteLabLoading) return;

    setDteLabLoading(true);
    setDteLabError("");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setDteLabLoading(false);
      router.push(`/login?redirectTo=${encodeURIComponent("/admin/facturacion")}`);
      return;
    }

    const res = await fetch("/api/admin/dte-lab/generate-xml", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      body: JSON.stringify({ ...settings, tenantId, tenantSlug }),
    });
    const json = await res.json().catch(() => null);

    setDteLabLoading(false);

    if (!res.ok || !json?.ok) {
      setDteLabError(json?.error ?? "No se pudo generar XML de laboratorio.");
      toast({
        title: "Laboratorio DTE",
        description: json?.error ?? "No se pudo generar XML de laboratorio.",
        variant: "destructive",
      });
      return;
    }

    setDteLabResult(json as DteLabResult);
    toast({ title: "XML DTE de laboratorio generado" });
  };

  const copyDteLabXml = async () => {
    if (!dteLabResult?.xml) return;

    await navigator.clipboard.writeText(dteLabResult.xml);
    toast({ title: "XML copiado" });
  };

  const clearDteLab = () => {
    setDteLabResult(null);
    setDteLabError("");
  };

  const buildPrintDocumentFromLab = () => {
    const folio = dteLabResult?.metadata.folioDummy ?? 1001;
    const totalAmount = dteLabResult?.metadata.montoTotal ?? 11900;
    const taxAmount = Math.round(totalAmount * 0.19);
    const netAmount = totalAmount - taxAmount;

    return {
      documentType:
        (dteLabResult?.metadata.tipoDte as DteDocumentType | undefined) ??
        "boleta_afecta",
      folio,
      issueDate: new Date().toISOString().slice(0, 10),
      issuer: {
        tenantId,
        rut: settings.taxId || dteLabResult?.metadata.rutEmisor || "76.123.456-0",
        legalName: settings.legalName || "Emisor demo Citaya",
        businessActivity: settings.businessActivity || "Servicios profesionales",
        address: settings.taxAddress || "Direccion demo",
        commune: settings.taxCommune || "La Serena",
        city: settings.taxCity || "La Serena",
        dteEnvironment: "lab" as const,
      },
      recipient: {
        rut: dteLabResult?.metadata.rutReceptor || "11.111.111-1",
        legalName: "Cliente Demo",
        businessActivity: "Persona natural",
        address: "Sin direccion",
        commune: settings.taxCommune || "La Serena",
        city: settings.taxCity || "La Serena",
      },
      lines: [
        {
          name: "Reserva demo Citaya",
          description: "Muestra impresa de laboratorio",
          quantity: 1,
          unitPrice: totalAmount,
          amount: totalAmount,
        },
      ],
      netAmount,
      taxAmount,
      exemptAmount: 0,
      totalAmount,
      environment: "LAB" as const,
      statusLabel: "LAB / PENDIENTE SII",
      tedStatus: "pending" as const,
      trackId: null,
    };
  };

  const openPrintSample = () => {
    const html = buildDtePrintHtml(buildPrintDocumentFromLab());
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const downloadPdfSample = () => {
    const pdf = buildDtePdfLab(buildPrintDocumentFromLab());
    const link = document.createElement("a");
    link.href = pdf.dataUri;
    link.download = pdf.fileName;
    link.click();
    toast({ title: "PDF de muestra generado" });
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
              title="Laboratorio DTE Citaya"
              description="Genera un XML de prueba estilo SII sin emitir, sin firmar y sin enviar al SII."
              actions={
                <div className="flex flex-wrap gap-2">
                  {["LAB", "No productivo", "Sin envío SII", "Sin folio real", "XSD estructural LAB"].map(
                    (badge) => (
                      <span
                        key={badge}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-black uppercase text-slate-600"
                      >
                        {badge}
                      </span>
                    ),
                  )}
                </div>
              }
            >
              <div className="grid gap-4">
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">
                  Este laboratorio no emite DTE real, no firma XML real, no envía al
                  SII, no usa CAF real, no consume folio real y no tiene validez
                  tributaria.
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    ["XML", "estilo SII"],
                    ["Firma", "mock/no real"],
                    ["CAF/Folios", "dummy"],
                    ["Estado SII", "simulado"],
                    ["XSD", "estructura LAB pasa; cripto pendiente"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="text-xs font-black uppercase text-slate-500">
                        {label}
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void generateDteLabXml()}
                    disabled={dteLabLoading || !tenantId}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {dteLabLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FlaskConical className="h-4 w-4" />
                    )}
                    {dteLabLoading ? "Generando..." : "Generar XML de prueba"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyDteLabXml()}
                    disabled={!dteLabResult?.xml}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Clipboard className="h-4 w-4" />
                    Copiar XML
                  </button>
                  <button
                    type="button"
                    onClick={clearDteLab}
                    disabled={!dteLabResult && !dteLabError}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Eraser className="h-4 w-4" />
                    Limpiar
                  </button>
                  <button
                    type="button"
                    onClick={openPrintSample}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm"
                  >
                    <Eye className="h-4 w-4" />
                    Ver muestra
                  </button>
                  <button
                    type="button"
                    onClick={downloadPdfSample}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm"
                  >
                    <FileDown className="h-4 w-4" />
                    Generar PDF de prueba
                  </button>
                </div>

                {dteLabError ? (
                  <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-800">
                    {dteLabError}
                  </div>
                ) : null}

                {dteLabResult ? (
                  <div className="grid gap-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        ["tipo DTE", labMetadataLabel(dteLabResult.metadata.tipoDte)],
                        ["folio dummy", String(dteLabResult.metadata.folioDummy)],
                        ["RUT emisor", dteLabResult.metadata.rutEmisor],
                        ["RUT receptor", dteLabResult.metadata.rutReceptor],
                        ["monto total", `$${dteLabResult.metadata.montoTotal.toLocaleString("es-CL")}`],
                        ["modo", dteLabResult.metadata.modo],
                        ["xsdStatus", dteLabResult.metadata.xsdStatus],
                        ["firma", dteLabResult.metadata.firma],
                        ["caf", dteLabResult.metadata.caf],
                        ["estadoSii", dteLabResult.metadata.estadoSii],
                        [
                          "certificacion",
                          dteLabResult.metadata.isProductionValid
                            ? "validado"
                            : "LAB / PENDIENTE",
                        ],
                        ["rango folios", dteLabResult.caf.range],
                        [
                          "folio simulado",
                          `${dteLabResult.folio.reservedFolio} (${dteLabResult.folio.reservationStatus}/${dteLabResult.folio.simulatedUsageStatus})`,
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-2xl border border-slate-200 bg-white p-3"
                        >
                          <div className="text-[11px] font-black uppercase text-slate-500">
                            {label}
                          </div>
                          <div className="mt-1 break-words text-sm font-black text-slate-900">
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-950">
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                        <div className="flex items-center gap-2 text-sm font-black text-white">
                          <Code2 className="h-4 w-4" />
                          XML DTE laboratorio
                        </div>
                        <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-black uppercase text-amber-200">
                          {dteLabResult.metadata.advertencia}
                        </span>
                      </div>
                      <pre className="max-h-[460px] overflow-auto p-4 text-xs leading-5 text-slate-100">
                        <code>{dteLabResult.xml}</code>
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>
            </AdminSectionCard>

            <AdminSectionCard
              title="Certificación SII"
              description="Ruta preparada para firma, CAF/TED, envío a certificación y consulta de track_id."
              actions={<StatusBadge label="PENDIENTE" tone="amber" />}
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["XSD oficial", "Estructura LAB pasa"],
                  ["TED real", "pendiente CAF externo"],
                  ["FRMT real", "pendiente llave CAF"],
                  ["XMLDSig real", "pendiente certificado"],
                  ["Track ID", "Sin envío SII"],
                  ["Estado SII", "No consultado"],
                  ["Rechazos", "Sin evidencia real"],
                  ["PDF tributario", "Muestra LAB"],
                  ["Ambiente", "LAB separado de certification"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="text-[11px] font-black uppercase text-slate-500">
                      {label}
                    </div>
                    <div className="mt-1 text-sm font-black text-slate-900">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">
                Los botones de envío a SII quedan deshabilitados hasta contar con XML
                validado contra XSD oficial, firma XML real, CAF/TED real y ambiente
                de certificación configurado.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Enviar a certificación
                </button>
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 opacity-50"
                >
                  <FileCheck2 className="h-4 w-4" />
                  Consultar track_id
                </button>
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
