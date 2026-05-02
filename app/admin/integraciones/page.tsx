import {
  BarChart3,
  Bot,
  CheckCircle2,
  FileText,
  Link2,
  Plug,
} from "lucide-react";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  StatusBadge,
} from "@/components/admin/admin-ui";

const integrationModules = [
  {
    key: "invoicing",
    title: "Facturación electrónica",
    status: "Próximamente",
    description:
      "Prepara boletas y facturas conectadas a un proveedor DTE/SII, sin complicar la operación diaria.",
    icon: FileText,
    features: [
      "Proveedor DTE/SII",
      "Emisión de boleta",
      "Emisión de factura",
      "Datos fiscales del cliente",
      "Historial de documentos",
    ],
    readiness: [
      "Datos del negocio",
      "Datos del cliente",
      "Reserva asociada",
      "Monto pagado o pendiente",
    ],
    button: "Configurar facturación",
    note: "Disponible cuando se conecte un proveedor DTE.",
  },
  {
    key: "collections_bot",
    title: "Chatbot de cobranza",
    status: "Próximamente",
    description:
      "Automatiza recordatorios de pago y seguimiento por WhatsApp o email según el estado de la reserva.",
    icon: Bot,
    features: [
      "Recordatorio de pago pendiente",
      "Confirmación de pago recibido",
      "Seguimiento por WhatsApp",
      "Fallback por email",
    ],
    preview:
      "Hola María, tienes un pago pendiente para asegurar tu reserva. Puedes completarlo aquí:",
    button: "Configurar chatbot",
    note: "Pensado para integrarse con n8n y WhatsApp API.",
  },
  {
    key: "financial_reports",
    title: "Reportes financieros",
    status: "En diseño",
    description:
      "Visualiza ingresos, pagos pendientes, abonos y métodos de pago más usados.",
    icon: BarChart3,
    features: [
      "Ingresos confirmados",
      "Pagos pendientes",
      "Abonos recibidos",
      "Métodos más usados",
    ],
    bars: [
      { label: "Confirmados", value: 72, className: "bg-emerald-500" },
      { label: "Pendientes", value: 38, className: "bg-amber-500" },
      { label: "Fallidos", value: 14, className: "bg-red-500" },
    ],
    button: "Ver reportes",
    note: "Se activará cuando exista más historial financiero.",
  },
  {
    key: "reconciliation",
    title: "Conciliación de pagos",
    status: "Próximamente",
    description:
      "Cruza pagos recibidos con reservas, estados pendientes y comprobantes manuales.",
    icon: Link2,
    features: [
      "Reserva asociada",
      "Estado de pago",
      "Medio de pago",
      "Comprobante",
      "Validación manual",
    ],
    flow: ["Reserva", "Pago", "Validación", "Confirmación"],
    button: "Configurar conciliación",
    note: "Pensado para pagos manuales, transferencia y medios externos.",
  },
] as const;

export default function AdminIntegracionesPage() {
  return (
    <AdminPageShell width="wide">
      <AdminNav />
      <AdminPageHeader
        eyebrow="Pro"
        title="Integraciones"
        description="Conecta Citaya con facturación, cobranza, reportes y automatizaciones para tu negocio."
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard
          label="Automatizaciones"
          value="Preparadas"
          hint="Base lista para conectar flujos"
          tone="blue"
        />
        <AdminKpiCard
          label="Facturación"
          value="Próximamente"
          hint="Boletas y facturas vía proveedor DTE"
        />
        <AdminKpiCard
          label="Cobranza"
          value="Email / WhatsApp"
          hint="Recordatorios y seguimiento"
          tone="amber"
        />
        <AdminKpiCard
          label="Reportes"
          value="En diseño"
          hint="Métricas para decisiones"
          tone="green"
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {integrationModules.map((module) => {
          const Icon = module.icon;

          return (
            <AdminSectionCard
              key={module.key}
              title={module.title}
              description={module.description}
              actions={
                <StatusBadge
                  status={module.status === "En diseño" ? "draft" : "upcoming"}
                  label={module.status}
                />
              }
            >
              <div className="grid gap-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {module.features.map((feature) => (
                    <div
                      key={feature}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700"
                    >
                      {feature}
                    </div>
                  ))}
                </div>

                {"readiness" in module ? (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                    <div className="text-sm font-black text-emerald-900">Base preparada</div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {module.readiness.map((item) => (
                        <div key={item} className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {"preview" in module ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-2 text-xs font-black uppercase text-slate-500">
                      Preview
                    </div>
                    <p className="text-sm font-medium leading-6 text-slate-700">{module.preview}</p>
                    <div className="mt-3 rounded-xl bg-slate-900 px-3 py-2 text-center text-sm font-black text-white">
                      Completar pago
                    </div>
                  </div>
                ) : null}

                {"bars" in module ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    {module.bars.map((bar) => (
                      <div key={bar.label} className="mb-3 last:mb-0">
                        <div className="mb-1 flex justify-between text-xs font-black text-slate-500">
                          <span>{bar.label}</span>
                          <span>{bar.value}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${bar.className}`}
                            style={{ width: `${bar.value}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {"flow" in module ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {module.flow.map((step, index) => (
                        <div key={step} className="flex items-center gap-2">
                          <span className="rounded-xl bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm">
                            {step}
                          </span>
                          {index < module.flow.length - 1 ? (
                            <span className="text-sm font-black text-slate-400">{"->"}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <button
                    type="button"
                    disabled
                    className="rounded-xl border bg-slate-100 px-4 py-2 text-sm font-black text-slate-400 disabled:cursor-not-allowed"
                  >
                    {module.button}
                  </button>
                  <p className="mt-2 text-xs font-bold text-slate-500">{module.note}</p>
                </div>
              </div>
            </AdminSectionCard>
          );
        })}
      </div>

      <AdminSectionCard className="mt-4" title="Estado de conexión">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="inactive" label="No conectado">
            <Plug className="mr-1 h-3.5 w-3.5" />
            No conectado
          </StatusBadge>
          <StatusBadge status="prepared" label="Base preparada" />
          <StatusBadge status="upcoming" label="Disponible pronto" />
        </div>
      </AdminSectionCard>
    </AdminPageShell>
  );
}
