"use client";

import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/admin/admin-ui";
import { adminFetch } from "@/lib/api/adminFetch";

type AppointmentDocumentContext = {
  appointmentId: string;
  requestedDocumentType: 33 | 39 | null;
  documentStatus: string | null;
  intent: {
    status: string;
    resolvedDteType: 33 | 39 | null;
    folio: number | null;
    displayStatus: string;
  } | null;
  activeDraft: {
    id: string;
    status: string;
    dteType: 33 | 39 | null;
  } | null;
  hasActiveCoverage: boolean;
  canRequestBoleta: boolean;
  canRequestFactura: boolean;
  actionBlockedReason: string | null;
};

type ContextState =
  | { kind: "loading" }
  | { kind: "loaded"; context: AppointmentDocumentContext }
  | { kind: "unavailable" };

const contextCache = new Map<string, AppointmentDocumentContext>();
const unavailableIds = new Set<string>();
const listeners = new Map<string, Set<(state: ContextState) => void>>();
let queuedIds = new Set<string>();
let flushScheduled = false;

function publish(appointmentId: string, state: ContextState) {
  for (const listener of listeners.get(appointmentId) ?? []) listener(state);
}

async function flushQueue() {
  flushScheduled = false;
  const appointmentIds = Array.from(queuedIds);
  queuedIds = new Set<string>();
  if (appointmentIds.length === 0) return;

  try {
    const response = await adminFetch("/api/admin/dte-context/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentIds }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !Array.isArray(payload.contexts)) {
      throw new Error("DTE_CONTEXT_UNAVAILABLE");
    }
    const returned = new Set<string>();
    for (const context of payload.contexts as AppointmentDocumentContext[]) {
      if (!context?.appointmentId) continue;
      returned.add(context.appointmentId);
      contextCache.set(context.appointmentId, context);
      unavailableIds.delete(context.appointmentId);
      publish(context.appointmentId, { kind: "loaded", context });
    }
    for (const appointmentId of appointmentIds) {
      if (returned.has(appointmentId)) continue;
      unavailableIds.add(appointmentId);
      publish(appointmentId, { kind: "unavailable" });
    }
  } catch {
    for (const appointmentId of appointmentIds) {
      unavailableIds.add(appointmentId);
      publish(appointmentId, { kind: "unavailable" });
    }
  }
}

function subscribe(
  appointmentId: string,
  listener: (state: ContextState) => void,
) {
  const cached = contextCache.get(appointmentId);
  if (cached) {
    listener({ kind: "loaded", context: cached });
    return () => undefined;
  }
  if (unavailableIds.has(appointmentId)) {
    listener({ kind: "unavailable" });
    return () => undefined;
  }

  const set = listeners.get(appointmentId) ?? new Set();
  set.add(listener);
  listeners.set(appointmentId, set);
  queuedIds.add(appointmentId);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => void flushQueue());
  }

  return () => {
    const current = listeners.get(appointmentId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(appointmentId);
  };
}

function documentTypeLabel(type: 33 | 39 | null) {
  if (type === 33) return "Factura 33";
  if (type === 39) return "Boleta 39";
  return "Documento";
}

function intentTone(status: string) {
  const normalized = status.toUpperCase();
  if (["ACCEPTED", "ACCEPTED_WITH_OBJECTIONS", "DELIVERED"].includes(normalized)) {
    return "green" as const;
  }
  if (["REJECTED", "BLOCKED", "AMBIGUOUS"].includes(normalized)) {
    return "red" as const;
  }
  if (["REVIEW_REQUIRED"].includes(normalized)) return "amber" as const;
  return "blue" as const;
}

export default function PaymentDocumentCell({ appointmentId }: { appointmentId: string }) {
  const [state, setState] = useState<ContextState>({ kind: "loading" });

  useEffect(() => subscribe(appointmentId, setState), [appointmentId]);

  if (state.kind === "loading") {
    return (
      <div className="grid gap-2">
        <StatusBadge label="Consultando documento…" tone="slate" />
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className="grid gap-2">
        <StatusBadge label="Estado no disponible" tone="amber" />
        <span className="text-xs font-medium text-slate-500">
          Recarga antes de solicitar un documento.
        </span>
      </div>
    );
  }

  const { context } = state;
  const type = context.intent?.resolvedDteType ??
    context.activeDraft?.dteType ??
    context.requestedDocumentType;

  return (
    <div className="grid gap-2">
      {context.intent ? (
        <>
          <StatusBadge
            label={`${documentTypeLabel(type)} · ${context.intent.displayStatus}`}
            tone={intentTone(context.intent.status)}
          />
          {context.intent.folio ? (
            <span className="text-xs font-bold text-slate-500">
              Folio {context.intent.folio}
            </span>
          ) : null}
        </>
      ) : context.activeDraft ? (
        <StatusBadge
          label={`${documentTypeLabel(type)} · ${
            context.activeDraft.status === "REVIEW_REQUIRED"
              ? "Requiere revisión"
              : "Borrador"
          }`}
          tone={context.activeDraft.status === "REVIEW_REQUIRED" ? "amber" : "blue"}
        />
      ) : context.hasActiveCoverage ? (
        <StatusBadge label="Documento tributario asociado" tone="green" />
      ) : context.requestedDocumentType ? (
        <StatusBadge
          label={`${documentTypeLabel(context.requestedDocumentType)} solicitada`}
          tone="blue"
        />
      ) : (
        <StatusBadge label="Sin documento" tone="slate" />
      )}

      {context.canRequestBoleta ? (
        <button
          type="button"
          onClick={() => {
            window.location.href =
              `/admin/facturacion?appointmentId=${encodeURIComponent(appointmentId)}&dteType=39`;
          }}
          className="rounded-xl border bg-white px-3 py-2 text-xs font-bold text-slate-900"
        >
          Solicitar boleta
        </button>
      ) : null}

      {context.canRequestFactura ? (
        <button
          type="button"
          onClick={() => {
            window.location.href =
              `/admin/facturacion?appointmentId=${encodeURIComponent(appointmentId)}&dteType=33`;
          }}
          className="rounded-xl border bg-white px-3 py-2 text-xs font-bold text-slate-900"
        >
          Solicitar factura
        </button>
      ) : null}

      {!context.canRequestBoleta &&
      !context.canRequestFactura &&
      context.actionBlockedReason &&
      !context.intent ? (
        <span className="text-xs font-medium text-slate-500">
          {context.actionBlockedReason}
        </span>
      ) : null}
    </div>
  );
}
