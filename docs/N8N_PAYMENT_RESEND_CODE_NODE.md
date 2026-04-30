# N8N Payment Resend Code Node

Use this in the payment resend workflow after the Citaya webhook trigger.

```js
const {
  businessName = "Citaya",
  logoUrl = "",
  customerName = "Cliente",
  paymentLink,
  amount = 0,
  serviceName = "tu reserva",
  appointmentDate = "",
  whatsapp = "",
} = $json;

const amountLabel = Number(amount || 0).toLocaleString("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
    ${logoUrl ? `<img src="${logoUrl}" style="max-width:120px;margin-bottom:10px;" />` : ""}
    <h1 style="margin:0 0 12px;font-size:24px;">${businessName}</h1>
    <p style="font-size:16px;line-height:1.5;">Hola ${customerName},</p>
    <p style="font-size:16px;line-height:1.5;">
      Te reenviamos el link de pago de ${serviceName}. Para mantener tu reserva activa, completa el pago lo antes posible.
    </p>
    <div style="margin:20px 0;padding:14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;">
      <div style="font-size:13px;color:#64748b;">Monto pendiente</div>
      <div style="font-size:22px;font-weight:700;">${amountLabel}</div>
      ${appointmentDate ? `<div style="margin-top:8px;font-size:13px;color:#64748b;">Reserva: ${appointmentDate}</div>` : ""}
    </div>
    <a href="${paymentLink}" style="display:inline-block;background:#0f172a;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
      Pagar ahora
    </a>
    <p style="margin-top:20px;font-size:13px;color:#64748b;">
      Si ya pagaste, puedes ignorar este mensaje. ${whatsapp ? `Dudas: ${whatsapp}` : ""}
    </p>
  </div>
`;

return [{ json: { ...$json, html } }];
```
