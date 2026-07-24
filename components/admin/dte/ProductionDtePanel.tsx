"use client";

import { useMemo, useState } from "react";

import { adminFetch } from "@/lib/api/adminFetch";

type SafeDocument = {
  id: string;
  dteType: 33 | 56 | 61;
  status: string;
  folio: number | null;
  totalAmount: number;
  siiStatus: string | null;
  hasTrackId: boolean;
  trackIdFingerprint: string | null;
};

export function ProductionDtePanel(props: {
  tenantId: string;
  tenantSlug: string;
}) {
  const [dteType, setDteType] = useState<33 | 56 | 61>(33);
  const [businessOperationId, setBusinessOperationId] = useState("");
  const [recipientRut, setRecipientRut] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [referenceType, setReferenceType] = useState("33");
  const [referenceFolio, setReferenceFolio] = useState("");
  const [referenceDate, setReferenceDate] = useState("");
  const [referenceCode, setReferenceCode] = useState("1");
  const [referenceReason, setReferenceReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [document, setDocument] = useState<SafeDocument | null>(null);
  const [message, setMessage] = useState(
    "Producción está desactivada por defecto.",
  );
  const [busy, setBusy] = useState(false);

  const expectedConfirmation = useMemo(
    () => (document ? `EMITIR DTE PRODUCCION ${document.id}` : ""),
    [document],
  );

  async function request(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await adminFetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: props.tenantId,
          tenantSlug: props.tenantSlug,
          ...body,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok)
        throw new Error(String(json?.error ?? "DTE_PRODUCTION_REQUEST_FAILED"));
      if (json.document) setDocument(json.document as SafeDocument);
      setMessage(
        json.preflight
          ? json.preflight.ready
            ? "Preflight productivo listo."
            : "Preflight incompleto."
          : "Acción registrada.",
      );
      return json;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "DTE_PRODUCTION_REQUEST_FAILED",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createDraft() {
    await request("/api/admin/dte-production/drafts", {
      dteType,
      businessOperationId,
      recipient: {
        rut: recipientRut,
        legalName: recipientName,
        email: recipientEmail,
      },
      lines: [
        {
          name: itemName,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
        },
      ],
      references:
        dteType !== 33 || referenceFolio || referenceDate || referenceReason
          ? [
              {
                documentType: referenceType,
                folio: referenceFolio,
                date: referenceDate,
                code: referenceCode,
                reason: referenceReason,
                isGlobal: false,
              },
            ]
          : [],
    });
  }

  async function download(kind: "dte_xml" | "pdf") {
    if (!document) return;
    setBusy(true);
    try {
      const query = new URLSearchParams({
        tenantId: props.tenantId,
        tenantSlug: props.tenantSlug,
      });
      const response = await adminFetch(
        `/api/admin/dte-production/${document.id}/artifacts/${kind}?${query}`,
      );
      if (!response.ok) throw new Error("DTE_ARTIFACT_DOWNLOAD_FAILED");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${document.dteType}-${document.folio}.${kind === "pdf" ? "pdf" : "xml"}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "DTE_ARTIFACT_DOWNLOAD_FAILED",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">
            Emisión DTE productiva
          </div>
          <div className="mt-1 text-sm font-bold text-slate-700">
            Preparar → revisar → emitir una vez → consultar manualmente
          </div>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
          Fail-closed
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <select
          className="rounded-xl border border-slate-200 p-3 text-sm"
          value={dteType}
          onChange={(event) =>
            setDteType(Number(event.target.value) as 33 | 56 | 61)
          }
        >
          <option value={33}>Factura electrónica 33</option>
          <option value={56}>Nota de débito 56</option>
          <option value={61}>Nota de crédito 61</option>
        </select>
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          placeholder="Referencia única de negocio"
          value={businessOperationId}
          onChange={(event) => setBusinessOperationId(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          placeholder="RUT receptor"
          value={recipientRut}
          onChange={(event) => setRecipientRut(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          placeholder="Razón social receptor"
          value={recipientName}
          onChange={(event) => setRecipientName(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          placeholder="Email receptor"
          value={recipientEmail}
          onChange={(event) => setRecipientEmail(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          placeholder="Detalle"
          value={itemName}
          onChange={(event) => setItemName(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          inputMode="numeric"
          placeholder="Cantidad"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          inputMode="numeric"
          placeholder="Precio unitario CLP"
          value={unitPrice}
          onChange={(event) => setUnitPrice(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          placeholder="Tipo documento referencia (ej. 33)"
          value={referenceType}
          onChange={(event) => setReferenceType(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          placeholder="Folio referencia"
          value={referenceFolio}
          onChange={(event) => setReferenceFolio(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          type="date"
          aria-label="Fecha documento de referencia"
          value={referenceDate}
          onChange={(event) => setReferenceDate(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm"
          placeholder="Código referencia"
          value={referenceCode}
          onChange={(event) => setReferenceCode(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 p-3 text-sm md:col-span-2"
          placeholder="Motivo de la referencia"
          value={referenceReason}
          onChange={(event) => setReferenceReason(event.target.value)}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
          disabled={busy || !props.tenantId}
          onClick={() => void createDraft()}
        >
          Crear borrador
        </button>
        <button
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black disabled:opacity-50"
          disabled={busy || !document}
          onClick={() =>
            void request(
              `/api/admin/dte-production/${document?.id}/prepare`,
              {},
            )
          }
        >
          Preparar
        </button>
        <button
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black disabled:opacity-50"
          disabled={busy || !document}
          onClick={() =>
            void request(
              `/api/admin/dte-production/${document?.id}/preflight`,
              {},
            )
          }
        >
          Revisar preflight
        </button>
      </div>

      {document && (
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm">
          <div className="font-black">
            DTE {document.dteType} · {document.status} · folio{" "}
            {document.folio ?? "pendiente"}
          </div>
          <div className="mt-1 text-slate-600">
            Total derivado: ${document.totalAmount.toLocaleString("es-CL")} ·
            Track ID: {document.hasTrackId ? document.trackIdFingerprint : "no disponible"}
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              className="rounded-xl border border-red-200 bg-white p-3 font-mono text-xs"
              placeholder={expectedConfirmation}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <button
              className="rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
              disabled={busy || confirmation !== expectedConfirmation}
              onClick={() =>
                void request(
                  `/api/admin/dte-production/${document.id}/emit`,
                  { confirmation },
                )
              }
            >
              Emitir exactamente una vez
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black"
              disabled={busy || !document.hasTrackId}
              onClick={() =>
                void request(
                  `/api/admin/dte-production/${document.id}/status`,
                  {},
                )
              }
            >
              Consultar estado manualmente
            </button>
            <button
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black"
              disabled={busy || !["ready", "submitted"].includes(document.status)}
              onClick={() => void download("dte_xml")}
            >
              Descargar XML
            </button>
            <button
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black"
              disabled={busy || !["ready", "submitted"].includes(document.status)}
              onClick={() => void download("pdf")}
            >
              Descargar PDF
            </button>
          </div>
        </div>
      )}
      <div className="mt-3 text-xs font-bold text-slate-600">{message}</div>
    </section>
  );
}
