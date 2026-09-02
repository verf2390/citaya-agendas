export const LEGAL_REVIEW_NOTICE =
  "Plantillas operativas: deben ser revisadas por un abogado chileno antes de su adopción comercial definitiva.";

export const LEGAL_DOCUMENT_LABELS = {
  consumer_terms: "Términos y condiciones",
  privacy_notice: "Aviso de privacidad",
  cancellation_refund_policy: "Cancelación, reprogramación y reembolsos",
  sensitive_data_authorization: "Autorización de datos sensibles",
  dte_mandate: "Mandato operativo DTE",
  saas_terms: "Términos SaaS",
} as const;

export type LegalDocumentType = keyof typeof LEGAL_DOCUMENT_LABELS;

export const LEGAL_DRAFT_TEMPLATES: Record<LegalDocumentType, string> = {
  consumer_terms: `Prestador: [PENDIENTE: razón social y RUT del tenant].\n\nEl prestador indicado ofrece el servicio descrito en la reserva. Citaya, operada por R&G Soluciones Integrales SpA, proporciona la plataforma tecnológica y no sustituye al prestador.\n\nAntes de confirmar, el consumidor verá el servicio, fecha, hora, precio total y condiciones aplicables. Los derechos irrenunciables reconocidos por la legislación chilena se mantienen plenamente vigentes.\n\nContacto para consultas o reclamos: [PENDIENTE: canal del tenant].`,
  privacy_notice: `Responsable del tratamiento: [PENDIENTE: identidad del tenant].\n\nLos datos se tratarán para gestionar la reserva, prestar el servicio, atender solicitudes, cumplir obligaciones legales y mantener evidencia de las preferencias informadas. R&G Soluciones Integrales SpA/Citaya actúa normalmente como proveedor tecnológico y encargado del tratamiento por cuenta del tenant.\n\nSe conservarán solo durante los plazos necesarios o legalmente exigibles. Las comunicaciones promocionales requieren una autorización separada y revocable.\n\nContacto de privacidad: [PENDIENTE: nombre y correo].`,
  cancellation_refund_policy: `Prestador: [PENDIENTE: identidad del tenant].\n\nCancelación: [PENDIENTE: condiciones y anticipación].\nReprogramación: [PENDIENTE: condiciones y disponibilidad].\nInasistencia: [PENDIENTE: consecuencias proporcionales].\nReembolsos: [PENDIENTE: supuestos, medio y plazo verificable].\n\nEsta política no limita derechos irrenunciables del consumidor ni impide ejercer las acciones que reconoce la ley.`,
  sensitive_data_authorization: `Finalidad específica: [PENDIENTE: describir el dato sensible y por qué es necesario para prestar el servicio].\n\nAutorizo de forma explícita el tratamiento de los datos sensibles estrictamente necesarios para esa finalidad. Esta autorización no comprende finalidades genéricas o ilimitadas. Se informarán los canales disponibles para ejercer los derechos aplicables.`,
  dte_mandate: `El tenant autoriza a R&G Soluciones Integrales SpA/Citaya, en calidad de proveedor tecnológico, para generar, firmar, enviar, consultar y conservar DTE por cuenta del tenant, y para custodiar certificados y CAF bajo controles de seguridad.\n\nEl firmante declara contar con facultades suficientes para representar al tenant. Esta aceptación constituye evidencia contractual electrónica y no se presenta como firma electrónica avanzada.\n\n[PENDIENTE: revisar alcance, vigencia y terminación con abogado chileno].`,
  saas_terms: `Partes: R&G Soluciones Integrales SpA/Citaya y [PENDIENTE: identidad del tenant].\n\nCitaya proporciona la plataforma tecnológica. El tenant conserva la responsabilidad por sus servicios, precios, información comercial, políticas y datos tributarios. R&G actúa normalmente como encargado del tratamiento de los datos de clientes del tenant.\n\n[PENDIENTE: vigencia, soporte, remuneración, terminación y anexos de tratamiento]. Ninguna estipulación elimina derechos irrenunciables ni establece ausencia absoluta de responsabilidad.`,
};
