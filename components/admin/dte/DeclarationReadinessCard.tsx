"use client";

import { CheckCircle2, XCircle } from "lucide-react";

import {
  AdminSectionCard,
  StatusBadge,
} from "@/components/admin/admin-ui";
import {
  billingComplianceLabels,
  type BillingComplianceState,
} from "@/lib/dte/billing-compliance";

export type DeclarationReadinessState = BillingComplianceState & {
  readyForDeclaration: boolean;
  readyForIssuance: boolean;
  issuerProfileState: string;
  trustAnchorValid: boolean;
  trustAnchorSha256Pinned: boolean;
  trustAnchorAcquisitionReady: boolean;
  cafImportFailClosed: boolean;
  productionCafCount: number;
  availableFolioCount: number;
};

export default function DeclarationReadinessCard({
  state,
}: {
  state: DeclarationReadinessState;
}) {
  const labels = billingComplianceLabels(state);
  const items = [
    {
      label: labels.declaration,
      detail: state.declarationRegistered
        ? "La declaración y su evidencia vigente están registradas."
        : "Aún falta registrar la declaración de cumplimiento.",
      ok: state.declarationRegistered,
    },
    {
      label: labels.authorization,
      detail: state.authorizationCurrent
        ? "La evidencia SII vigente cubre los tipos activos."
        : "No existe evidencia vigente para todos los tipos activos.",
      ok: state.authorizationCurrent,
    },
    {
      label: labels.issuance,
      detail: state.readyForFirstInvoiceFromUi
        ? "La emisión manual está habilitada con gates persistidos vigentes."
        : "La emisión permanece cerrada hasta completar los gates.",
      ok: state.readyForFirstInvoiceFromUi,
    },
    {
      label: state.trustAnchorValid
        ? "Trust anchor validado"
        : "Trust anchor pendiente",
      detail: state.trustAnchorValid
        ? "Llave oficial y hash verificados."
        : "Se adquirirá desde una fuente oficial después de la autorización.",
      ok: state.trustAnchorValid,
    },
    {
      label:
        state.productionCafCount > 0
          ? "CAF productivo disponible"
          : "CAF productivo pendiente",
      detail:
        state.productionCafCount > 0
          ? "Existe CAF productivo validado."
          : "Se solicitará e importará después de la autorización.",
      ok: state.productionCafCount > 0,
    },
  ];

  return (
    <AdminSectionCard
      className="mt-5"
      title="Declaración de cumplimiento"
      description="Estado regulatorio derivado de evidencia vigente, activación legal y readiness persistido."
      actions={
        <StatusBadge
          label={
            state.readyForFirstInvoiceFromUi
              ? "Cumplimiento vigente"
              : "Cumplimiento pendiente"
          }
          tone={state.readyForFirstInvoiceFromUi ? "green" : "amber"}
        />
      }
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3"
          >
            <div className="flex items-start gap-2">
              {item.ok ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              )}
              <div>
                <div className="text-sm font-black text-slate-900">
                  {item.label}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {item.detail}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminSectionCard>
  );
}
