import type { CafLabData, FolioReservation, FolioState } from "../types";

function countUsedReservations(state: FolioState): number {
  return state.reservations.filter((reservation) => reservation.status === "used")
    .length;
}

function countActiveReservations(state: FolioState): number {
  return state.reservations.filter(
    (reservation) =>
      reservation.status === "reserved" || reservation.status === "used",
  ).length;
}

function refreshAvailability(state: FolioState): FolioState {
  const total = state.rangeTo - state.rangeFrom + 1;
  const active = countActiveReservations(state);

  return {
    ...state,
    availableCount: Math.max(total - active, 0),
    usedCount: countUsedReservations(state),
  };
}

function assertReservationMatchesState(
  state: FolioState,
  reservation: FolioReservation,
): void {
  if (reservation.tenantId !== state.tenantId) {
    throw new Error("Folio reservation tenantId does not match folio state");
  }

  if (reservation.documentType !== state.documentType) {
    throw new Error("Folio reservation documentType does not match folio state");
  }

  if (reservation.folio < state.rangeFrom || reservation.folio > state.rangeTo) {
    throw new Error("Folio reservation is outside CAF lab range");
  }
}

// LAB / NO PRODUCTIVO: estado en memoria para simular control de folios.
export function createFolioStateFromCafLab(caf: CafLabData): FolioState {
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

export function reserveNextFolio(state: FolioState): {
  state: FolioState;
  reservation: FolioReservation;
} {
  const nextFolio = state.currentFolio;
  if (nextFolio > state.rangeTo) {
    throw new Error("No CAF lab folios available in range");
  }

  const existing = state.reservations.find(
    (reservation) =>
      reservation.folio === nextFolio &&
      (reservation.status === "reserved" || reservation.status === "used"),
  );

  if (existing) {
    throw new Error("CAF lab folio is already reserved or used");
  }

  const reservation: FolioReservation = {
    tenantId: state.tenantId,
    documentType: state.documentType,
    folio: nextFolio,
    status: "reserved",
    reservedAt: new Date().toISOString(),
  };

  const nextState = refreshAvailability({
    ...state,
    currentFolio: nextFolio + 1,
    reservations: [...state.reservations, reservation],
  });

  return { state: nextState, reservation };
}

export function markFolioUsed(
  state: FolioState,
  reservation: FolioReservation,
  documentId?: string,
): { state: FolioState; reservation: FolioReservation } {
  assertReservationMatchesState(state, reservation);

  if (reservation.status !== "reserved") {
    throw new Error("Only reserved CAF lab folios can be marked as used");
  }

  const alreadyUsed = state.reservations.some(
    (item) => item.folio === reservation.folio && item.status === "used",
  );
  if (alreadyUsed) {
    throw new Error("CAF lab folio was already used");
  }

  const usedReservation: FolioReservation = {
    ...reservation,
    status: "used",
    usedAt: new Date().toISOString(),
    documentId: documentId ?? reservation.documentId ?? null,
  };

  const nextState = refreshAvailability({
    ...state,
    reservations: state.reservations.map((item) =>
      item.folio === reservation.folio ? usedReservation : item,
    ),
  });

  return { state: nextState, reservation: usedReservation };
}

export function releaseFolio(
  state: FolioState,
  reservation: FolioReservation,
): { state: FolioState; reservation: FolioReservation } {
  assertReservationMatchesState(state, reservation);

  if (reservation.status !== "reserved") {
    throw new Error("Only reserved CAF lab folios can be released");
  }

  const releasedReservation: FolioReservation = {
    ...reservation,
    status: "released",
  };

  const nextState = refreshAvailability({
    ...state,
    reservations: state.reservations.map((item) =>
      item.folio === reservation.folio ? releasedReservation : item,
    ),
  });

  return { state: nextState, reservation: releasedReservation };
}

export function getFolioAvailability(state: FolioState): Pick<
  FolioState,
  "availableCount" | "currentFolio" | "rangeFrom" | "rangeTo" | "usedCount"
> {
  const refreshed = refreshAvailability(state);

  return {
    availableCount: refreshed.availableCount,
    currentFolio: refreshed.currentFolio,
    rangeFrom: refreshed.rangeFrom,
    rangeTo: refreshed.rangeTo,
    usedCount: refreshed.usedCount,
  };
}
