import { escapeXml } from "../xml/escape-xml";
import type { DtePrintDocument } from "./pdf-types";

function money(value?: number | null): string {
  return `$${Math.round(value ?? 0).toLocaleString("es-CL")}`;
}

function documentLabel(value: string): string {
  if (value === "boleta_afecta") return "Boleta afecta";
  if (value === "factura_afecta") return "Factura afecta";
  if (value === "boleta_exenta") return "Boleta exenta";
  if (value === "factura_exenta") return "Factura exenta";
  return value;
}

export function buildDtePrintHtml(document: DtePrintDocument): string {
  const nonProductionWarning =
    document.environment === "PRODUCTION"
      ? ""
      : `<div class="warning">MUESTRA ${document.environment}: no tiene validez tributaria productiva. Timbre/PDF417 real pendiente si corresponde.</div>`;

  const rows = document.lines
    .map(
      (line, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeXml(line.name)}</td>
          <td class="right">${line.quantity}</td>
          <td class="right">${money(line.unitPrice)}</td>
          <td class="right">${money(line.amount)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(documentLabel(document.documentType))} ${document.folio}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
    .sheet { max-width: 820px; margin: 0 auto; border: 1px solid #cbd5e1; padding: 28px; }
    .top { display: flex; justify-content: space-between; gap: 24px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .stamp { border: 2px solid #dc2626; color: #991b1b; padding: 12px; text-align: center; font-weight: 700; }
    .muted { color: #64748b; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 22px; }
    .box { border: 1px solid #e2e8f0; padding: 14px; }
    .label { color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .value { margin-top: 3px; font-size: 13px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 22px; font-size: 13px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 9px; text-align: left; }
    th { background: #f8fafc; font-size: 11px; text-transform: uppercase; color: #475569; }
    .right { text-align: right; }
    .totals { margin-top: 18px; margin-left: auto; width: 280px; }
    .total-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #e2e8f0; }
    .total { font-size: 18px; font-weight: 800; }
    .ted { margin-top: 24px; border: 1px dashed #94a3b8; padding: 22px; text-align: center; color: #475569; font-weight: 700; }
    .warning { margin-top: 18px; border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; padding: 12px; font-weight: 700; }
  </style>
</head>
<body>
  <main class="sheet">
    <section class="top">
      <div>
        <h1>${escapeXml(document.issuer.legalName)}</h1>
        <div class="muted">${escapeXml(document.issuer.businessActivity)}</div>
        <div class="muted">${escapeXml(document.issuer.address)}, ${escapeXml(document.issuer.commune)}</div>
      </div>
      <div class="stamp">
        RUT ${escapeXml(document.issuer.rut)}<br />
        ${escapeXml(documentLabel(document.documentType).toUpperCase())}<br />
        FOLIO ${document.folio}
      </div>
    </section>
    ${nonProductionWarning}
    <section class="grid">
      <div class="box">
        <div class="label">Receptor</div>
        <div class="value">${escapeXml(document.recipient.legalName)}</div>
        <div class="muted">RUT ${escapeXml(document.recipient.rut)}</div>
        <div class="muted">${escapeXml(document.recipient.address ?? "")}</div>
      </div>
      <div class="box">
        <div class="label">Documento</div>
        <div class="value">Fecha: ${escapeXml(document.issueDate)}</div>
        <div class="muted">Estado: ${escapeXml(document.statusLabel)}</div>
        <div class="muted">Ambiente: ${escapeXml(document.environment)}</div>
        <div class="muted">Track ID: ${escapeXml(document.trackId ?? "PENDIENTE")}</div>
      </div>
    </section>
    <table>
      <thead>
        <tr><th>#</th><th>Detalle</th><th class="right">Cantidad</th><th class="right">Precio</th><th class="right">Monto</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="totals">
      <div class="total-row"><span>Neto</span><strong>${money(document.netAmount)}</strong></div>
      <div class="total-row"><span>Exento</span><strong>${money(document.exemptAmount)}</strong></div>
      <div class="total-row"><span>IVA</span><strong>${money(document.taxAmount)}</strong></div>
      <div class="total-row total"><span>Total</span><strong>${money(document.totalAmount)}</strong></div>
    </section>
    <section class="ted">
      TIMBRE ELECTRONICO / PDF417<br />
      ${document.tedStatus === "real" ? "TED real insertado" : "PENDIENTE: no representa timbre SII real"}
    </section>
  </main>
</body>
</html>`;
}

