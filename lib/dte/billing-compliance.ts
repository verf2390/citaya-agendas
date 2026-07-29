export const BILLING_PRODUCTION_DTE_TYPES = [33, 56, 61] as const;

export type BillingActivationGate = {
  ready?: boolean;
};

export type BillingComplianceState = {
  declarationRegistered: boolean;
  authorizationCurrent: boolean;
  issuanceEnabled: boolean;
  readyForFirstInvoiceFromUi: boolean;
  activeDocumentTypes: number[];
};

export type BillingComplianceInput = {
  globalProductionEnabled: boolean;
  tenantProductionEnabled: boolean;
  issuerEnabled: boolean;
  issuerProfileState: string;
  authorizationEvidenceCurrent: boolean;
  authorizedTypes: number[];
  activeTypes: number[];
  activationGates: Record<number, BillingActivationGate | null | undefined>;
};

function supportedTypes(values: number[]): number[] {
  return [...new Set(values)]
    .filter((value) => BILLING_PRODUCTION_DTE_TYPES.includes(
      value as (typeof BILLING_PRODUCTION_DTE_TYPES)[number],
    ))
    .sort((left, right) => left - right);
}

export function deriveBillingCompliance(
  input: BillingComplianceInput,
): BillingComplianceState {
  const uniqueActiveTypes = [...new Set(input.activeTypes)];
  const activeDocumentTypes = supportedTypes(uniqueActiveTypes);
  const hasBlockedTypeActive = uniqueActiveTypes.some(
    (type) => !BILLING_PRODUCTION_DTE_TYPES.includes(
      type as (typeof BILLING_PRODUCTION_DTE_TYPES)[number],
    ),
  );
  const authorizedTypes = new Set(input.authorizedTypes);
  const declarationRegistered =
    input.authorizationEvidenceCurrent &&
    ["declared", "ready_for_issuance"].includes(input.issuerProfileState);
  const authorizationCurrent =
    declarationRegistered &&
    activeDocumentTypes.length > 0 &&
    activeDocumentTypes.every((type) => authorizedTypes.has(type));
  const activeGatesReady =
    activeDocumentTypes.length > 0 &&
    activeDocumentTypes.every(
      (type) => input.activationGates[type]?.ready === true,
    ) && !hasBlockedTypeActive;
  const issuanceEnabled = Boolean(
    input.globalProductionEnabled &&
      input.tenantProductionEnabled &&
      input.issuerEnabled &&
      authorizationCurrent &&
      activeGatesReady,
  );

  return {
    declarationRegistered,
    authorizationCurrent,
    issuanceEnabled,
    readyForFirstInvoiceFromUi:
      issuanceEnabled && activeDocumentTypes.includes(33),
    activeDocumentTypes,
  };
}

function typeList(types: number[]): string {
  if (types.length === 0) return "ningún tipo";
  if (types.length === 1) return String(types[0]);
  return `${types.slice(0, -1).join(", ")} y ${types.at(-1)}`;
}

export function billingComplianceLabels(state: BillingComplianceState) {
  return {
    declaration: state.declarationRegistered
      ? "Declaración cumplida"
      : "Declaración pendiente",
    authorization: state.authorizationCurrent
      ? "Autorización SII vigente"
      : "No autorizado todavía",
    issuance: state.readyForFirstInvoiceFromUi
      ? `Emisión habilitada para ${typeList(state.activeDocumentTypes)}`
      : "Emisión bloqueada",
  };
}
