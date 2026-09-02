"use client";

import { useState } from "react";
import { CheckCircle2, FileSearch, ShieldCheck } from "lucide-react";

type Result = {
  issuer: string;
  documentType: string;
  folio: number;
  issueDate: string;
  totalAmount: number;
  status: string;
  pdfUrl: string | null;
};

export default function VerifyBoletaPage() {
  const [issuerRut, setIssuerRut] = useState("");
  const [folio, setFolio] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setResult(null);
    const response = await fetch("/api/public/boleta-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issuerRut,
        documentType: 39,
        folio: Number(folio),
        issueDate,
        totalAmount: Number(String(totalAmount).replace(/\D/g, "")),
      }),
    });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error ?? "No pudimos realizar la consulta.");
      return;
    }
    if (!payload.found) {
      setMessage(payload.message);
      return;
    }
    setResult(payload.document);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-2xl bg-blue-600 p-3 text-white">
            <FileSearch className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">
              Verificar boleta electrónica
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Consulta individual de documentos emitidos por negocios que usan Citaya.
            </p>
          </div>
        </div>

        <form
          onSubmit={verify}
          className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 sm:p-7"
        >
          <label className="grid gap-1.5 text-sm font-bold">
            RUT emisor
            <input
              required
              value={issuerRut}
              onChange={(event) => setIssuerRut(event.target.value)}
              placeholder="76.123.456-7"
              className="h-11 rounded-xl border border-slate-200 px-3"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Tipo de documento
            <input
              readOnly
              value="Boleta electrónica"
              className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Folio
            <input
              required
              type="number"
              min={1}
              value={folio}
              onChange={(event) => setFolio(event.target.value)}
              className="h-11 rounded-xl border border-slate-200 px-3"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Fecha de emisión
            <input
              required
              type="date"
              value={issueDate}
              onChange={(event) => setIssueDate(event.target.value)}
              className="h-11 rounded-xl border border-slate-200 px-3"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold sm:col-span-2">
            Total
            <input
              required
              inputMode="numeric"
              value={totalAmount}
              onChange={(event) => setTotalAmount(event.target.value)}
              placeholder="Monto final en pesos"
              className="h-11 rounded-xl border border-slate-200 px-3"
            />
          </label>
          <button
            disabled={loading}
            className="h-11 rounded-xl bg-blue-600 px-5 font-black text-white disabled:opacity-50 sm:col-span-2"
          >
            {loading ? "Verificando…" : "Verificar documento"}
          </button>
          <p className="flex gap-2 text-xs text-slate-500 sm:col-span-2">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Debes ingresar todos los datos exactos. Esta página no permite listar documentos.
          </p>
        </form>

        {message ? (
          <p role="status" className="mt-5 rounded-2xl bg-white p-4 text-sm font-bold">
            {message}
          </p>
        ) : null}
        {result ? (
          <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:p-7">
            <h2 className="flex items-center gap-2 font-black text-emerald-950">
              <CheckCircle2 className="h-5 w-5" /> Documento encontrado
            </h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {[
                ["Emisor", result.issuer],
                ["Documento", result.documentType],
                ["Folio", result.folio],
                ["Fecha", result.issueDate],
                ["Total", `$${result.totalAmount.toLocaleString("es-CL")}`],
                ["Estado", result.status],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl bg-white p-3">
                  <dt className="text-xs font-bold uppercase text-slate-500">{label}</dt>
                  <dd className="mt-1 font-black">{value}</dd>
                </div>
              ))}
            </dl>
            {result.pdfUrl ? (
              <a
                href={result.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white"
              >
                Ver representación PDF
              </a>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
