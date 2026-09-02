import type { CafRealData, FolioReservation, FolioState } from "../types";

export function createFolioStateFromControlledCaf(caf: CafRealData): FolioState {
  return {
    tenantId: caf.tenantId,
    documentType: caf.documentType,
    currentFolio: caf.rangeFrom,
    rangeFrom: caf.rangeFrom,
    rangeTo: caf.rangeTo,
    availableCount: caf.rangeTo - caf.rangeFrom + 1,
    usedCount: 0,
    reservations: [],
  };
}

export function reserveControlledFolio(
  state: FolioState,
): { state: FolioState; reservation: FolioReservation } {
  if (state.currentFolio > state.rangeTo) {
    throw new Error("No quedan folios disponibles en el CAF controlado");
  }

  const reservation: FolioReservation = {
    tenantId: state.tenantId,
    documentType: state.documentType,
    folio: state.currentFolio,
    status: "reserved",
    reservedAt: new Date().toISOString(),
  };

  return {
    reservation,
    state: {
      ...state,
      currentFolio: state.currentFolio + 1,
      availableCount: Math.max(0, state.availableCount - 1),
      reservations: [...state.reservations, reservation],
    },
  };
}

