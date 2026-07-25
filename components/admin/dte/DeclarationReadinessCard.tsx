"use client";

import { CheckCircle2, XCircle } from "lucide-react";

import {
  AdminSectionCard,
  StatusBadge,
} from "@/components/admin/admin-ui";

export type DeclarationReadinessState = {
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
  const items = [
    {
      label: state.readyForDeclaration
        ? "Listo para declaración"
        : "Declaración pendiente",
      detail: state.readyForDeclaration
        ? "El representante legal puede efectuarla manualmente."
        : "Aún faltan controles previos.",
      ok: state.readyForDeclaration,
    },
    {
      label: state.readyForIssuance
        ? "Autorizado para emitir"
        : "No autorizado todavía",
      detail: state.readyForIssuance
        ? "El gate productivo está completo."
        : "La autorización productiva del SII sigue pendiente.",
      ok: state.readyForIssuance,
    },
    {
      label: state.readyForIssuance
        ? "Emisión habilitada"
        : "Emisión bloqueada",
      detail: state.readyForIssuance
        ? "Los controles de emisión están completos."
        : "No se puede emitir ni consumir folios.",
      ok: state.readyForIssuance,
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
      description="La declaración habilita el paso regulatorio; no autoriza ni activa la emisión."
      actions={
        <StatusBadge
          label={
            state.readyForDeclaration
              ? "Listo para declaración"
              : "Declaración aún bloqueada"
          }
          tone={state.readyForDeclaration ? "green" : "amber"}
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
