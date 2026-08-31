import { friendlyDteStatus } from "@/lib/dte/cutover";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const FINAL_INTENT_STATES = new Set([
  "ACCEPTED",
  "ACCEPTED_WITH_OBJECTIONS",
  "REJECTED",
  "CANCELED",
]);

const ACTIVE_DRAFT_STATES = ["DRAFT", "REVIEW_REQUIRED", "VALIDATED"] as const;

export type AppointmentDocumentContext = {
  appointmentId: string;
  customerId: string | null;
  saleId: string | null;
  requestedDocumentType: 33 | 39 | null;
  documentStatus: string | null;
  taxTreatmentStatus: string | null;
  paymentState: string | null;
  totalAmount: number | null;
  documentedAmount: number | null;
  pendingDocumentationAmount: number | null;
  intent: {
    id: string;
    status: string;
    resolvedDteType: 33 | 39 | null;
    productionDocumentId: string | null;
    siiStatus: string | null;
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

type SaleLinkRow = {
  appointment_id: string;
  sale_id: string;
};

type SaleRow = {
  id: string;
  requested_document_type: number | null;
  document_status: string | null;
  tax_treatment_status: string | null;
  payment_state: string | null;
  total_amount: number | null;
  documented_amount: number | null;
  pending_documentation_amount: number | null;
};

type SalePaymentRow = {
  sale_id: string;
  payment_intent_id: string;
  status: string;
};

type IntentRow = {
  id: string;
  payment_intent_id: string | null;
  resolved_dte_type: number | null;
  status: string;
  safe_blocking_reason: string | null;
  production_document_id: string | null;
  created_at: string;
};

type ProductionRow = {
  id: string;
  sii_status: string | null;
  folio: number | null;
};

type DraftRow = {
  id: string;
  appointment_id: string | null;
  dte_type: number | null;
  status: string;
  created_at: string;
};

type CoverageRow = {
  sale_id: string;
};

type AppointmentRow = {
  id: string;
  customer_id: string | null;
};

function documentType(value: unknown): 33 | 39 | null {
  const numeric = Number(value);
  return numeric === 33 || numeric === 39 ? numeric : null;
}

export function canonicalAdminDteDisplayStatus(input: {
  intentStatus: string | null | undefined;
  blockingReason?: string | null;
  siiStatus?: string | null;
}) {
  const normalizedIntent = String(input.intentStatus ?? "").toUpperCase();
  if (FINAL_INTENT_STATES.has(normalizedIntent)) {
    return friendlyDteStatus(
      normalizedIntent,
      input.blockingReason ?? null,
      null,
    );
  }
  return friendlyDteStatus(
    normalizedIntent,
    input.blockingReason ?? null,
    input.siiStatus ?? null,
  );
}

export function appointmentDocumentActionState(input: {
  requestedDocumentType: 33 | 39 | null;
  paymentState: string | null;
  hasIntent: boolean;
  hasActiveDraft: boolean;
  hasActiveCoverage: boolean;
}) {
  if (input.hasIntent) {
    return {
      canRequestBoleta: false,
      canRequestFactura: false,
      reason: "Ya existe un proceso tributario asociado a esta venta.",
    };
  }
  if (input.hasActiveDraft) {
    return {
      canRequestBoleta: false,
      canRequestFactura: false,
      reason: "Ya existe un borrador tributario asociado a esta reserva.",
    };
  }
  if (input.hasActiveCoverage) {
    return {
      canRequestBoleta: false,
      canRequestFactura: false,
      reason: "La venta ya tiene cobertura tributaria asociada.",
    };
  }
  if (input.requestedDocumentType) {
    return {
      canRequestBoleta: false,
      canRequestFactura: false,
      reason:
        input.requestedDocumentType === 33
          ? "La venta ya tiene Factura 33 solicitada."
          : "La venta ya tiene Boleta 39 solicitada.",
    };
  }
  if (String(input.paymentState ?? "").toUpperCase() !== "PAID") {
    return {
      canRequestBoleta: false,
      canRequestFactura: false,
      reason: "La venta debe estar pagada antes de preparar el documento tributario.",
    };
  }
  return {
    canRequestBoleta: true,
    canRequestFactura: true,
    reason: null,
  };
}

export async function loadAdminAppointmentDocumentContexts(
  tenantId: string,
  appointmentIds: readonly string[],
): Promise<AppointmentDocumentContext[]> {
  const ids = Array.from(new Set(appointmentIds.filter(Boolean))).slice(0, 200);
  if (ids.length === 0) return [];

  const [appointmentsResult, linksResult, draftsResult] = await Promise.all([
    supabaseAdmin
      .from("appointments")
      .select("id,customer_id")
      .eq("tenant_id", tenantId)
      .in("id", ids),
    supabaseAdmin
      .from("billing_sale_appointments")
      .select("appointment_id,sale_id")
      .eq("tenant_id", tenantId)
      .in("appointment_id", ids),
    supabaseAdmin
      .from("dte_invoice_drafts")
      .select("id,appointment_id,dte_type,status,created_at")
      .eq("tenant_id", tenantId)
      .in("appointment_id", ids)
      .in("status", [...ACTIVE_DRAFT_STATES])
      .order("created_at", { ascending: false }),
  ]);

  if (appointmentsResult.error || linksResult.error || draftsResult.error) {
    throw new Error("DTE_APPOINTMENT_CONTEXT_UNAVAILABLE");
  }

  const appointments = (appointmentsResult.data ?? []) as AppointmentRow[];
  const links = (linksResult.data ?? []) as SaleLinkRow[];
  const drafts = (draftsResult.data ?? []) as DraftRow[];
  const saleIds = Array.from(new Set(links.map((row) => row.sale_id)));

  const [salesResult, paymentsResult, coverageResult] = saleIds.length
    ? await Promise.all([
        supabaseAdmin
          .from("billing_sales")
          .select(
            "id,requested_document_type,document_status,tax_treatment_status,payment_state,total_amount,documented_amount,pending_documentation_amount",
          )
          .eq("tenant_id", tenantId)
          .in("id", saleIds),
        supabaseAdmin
          .from("billing_sale_payments")
          .select("sale_id,payment_intent_id,status")
          .eq("tenant_id", tenantId)
          .in("sale_id", saleIds),
        supabaseAdmin
          .from("billing_sale_item_document_coverage")
          .select("sale_id")
          .eq("tenant_id", tenantId)
          .in("sale_id", saleIds)
          .neq("status", "VOID"),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (salesResult.error || paymentsResult.error || coverageResult.error) {
    throw new Error("DTE_APPOINTMENT_CONTEXT_UNAVAILABLE");
  }

  const sales = (salesResult.data ?? []) as SaleRow[];
  const salePayments = (paymentsResult.data ?? []) as SalePaymentRow[];
  const coverage = (coverageResult.data ?? []) as CoverageRow[];
  const paymentIntentIds = Array.from(
    new Set(
      salePayments
        .filter((row) => row.status === "VERIFIED")
        .map((row) => row.payment_intent_id)
        .filter(Boolean),
    ),
  );

  const intentsResult = paymentIntentIds.length
    ? await supabaseAdmin
        .from("dte_payment_document_intents")
        .select(
          "id,payment_intent_id,resolved_dte_type,status,safe_blocking_reason,production_document_id,created_at",
        )
        .eq("tenant_id", tenantId)
        .in("payment_intent_id", paymentIntentIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  if (intentsResult.error) {
    throw new Error("DTE_APPOINTMENT_CONTEXT_UNAVAILABLE");
  }
  const intents = (intentsResult.data ?? []) as IntentRow[];
  const productionIds = Array.from(
    new Set(
      intents
        .map((row) => row.production_document_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const productionResult = productionIds.length
    ? await supabaseAdmin
        .from("dte_production_documents")
        .select("id,sii_status,folio")
        .eq("tenant_id", tenantId)
        .in("id", productionIds)
    : { data: [], error: null };
  if (productionResult.error) {
    throw new Error("DTE_APPOINTMENT_CONTEXT_UNAVAILABLE");
  }
  const production = (productionResult.data ?? []) as ProductionRow[];

  const appointmentById = new Map(appointments.map((row) => [row.id, row]));
  const saleById = new Map(sales.map((row) => [row.id, row]));
  const saleIdByAppointment = new Map(
    links.map((row) => [row.appointment_id, row.sale_id]),
  );
  const productionById = new Map(production.map((row) => [row.id, row]));
  const coveredSaleIds = new Set(coverage.map((row) => row.sale_id));

  return ids.map((appointmentId) => {
    const appointment = appointmentById.get(appointmentId) ?? null;
    const saleId = saleIdByAppointment.get(appointmentId) ?? null;
    const sale = saleId ? saleById.get(saleId) ?? null : null;
    const paymentIntentIdSet = new Set(
      salePayments
        .filter((row) => row.sale_id === saleId && row.status === "VERIFIED")
        .map((row) => row.payment_intent_id),
    );
    const intent = intents.find(
      (row) => row.payment_intent_id && paymentIntentIdSet.has(row.payment_intent_id),
    ) ?? null;
    const productionDocument = intent?.production_document_id
      ? productionById.get(intent.production_document_id) ?? null
      : null;
    const activeDraft = drafts.find((row) => row.appointment_id === appointmentId) ?? null;
    const requestedDocumentType = documentType(sale?.requested_document_type);
    const action = appointmentDocumentActionState({
      requestedDocumentType,
      paymentState: sale?.payment_state ?? null,
      hasIntent: Boolean(intent),
      hasActiveDraft: Boolean(activeDraft),
      hasActiveCoverage: saleId ? coveredSaleIds.has(saleId) : false,
    });

    return {
      appointmentId,
      customerId: appointment?.customer_id ?? null,
      saleId,
      requestedDocumentType,
      documentStatus: sale?.document_status ?? null,
      taxTreatmentStatus: sale?.tax_treatment_status ?? null,
      paymentState: sale?.payment_state ?? null,
      totalAmount: sale?.total_amount === null || sale?.total_amount === undefined
        ? null
        : Number(sale.total_amount),
      documentedAmount:
        sale?.documented_amount === null || sale?.documented_amount === undefined
          ? null
          : Number(sale.documented_amount),
      pendingDocumentationAmount:
        sale?.pending_documentation_amount === null ||
        sale?.pending_documentation_amount === undefined
          ? null
          : Number(sale.pending_documentation_amount),
      intent: intent
        ? {
            id: intent.id,
            status: intent.status,
            resolvedDteType: documentType(intent.resolved_dte_type),
            productionDocumentId: intent.production_document_id,
            siiStatus: productionDocument?.sii_status ?? null,
            folio: productionDocument?.folio ?? null,
            displayStatus: canonicalAdminDteDisplayStatus({
              intentStatus: intent.status,
              blockingReason: intent.safe_blocking_reason,
              siiStatus: productionDocument?.sii_status ?? null,
            }),
          }
        : null,
      activeDraft: activeDraft
        ? {
            id: activeDraft.id,
            status: activeDraft.status,
            dteType: documentType(activeDraft.dte_type),
          }
        : null,
      hasActiveCoverage: saleId ? coveredSaleIds.has(saleId) : false,
      canRequestBoleta: action.canRequestBoleta,
      canRequestFactura: action.canRequestFactura,
      actionBlockedReason: action.reason,
    };
  });
}
