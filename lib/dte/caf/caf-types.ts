import type { DteDocumentType } from "../dte-types";

export type ControlledCafInput = {
  tenantId: string;
  cafXml: string;
};

export type ControlledCafValidation = {
  issuerRut: string;
  documentType: DteDocumentType;
  rangeFrom: number;
  rangeTo: number;
  authorizationDate: string;
};

export type ControlledFolioState = {
  tenantId: string;
  documentType: DteDocumentType;
  rangeFrom: number;
  rangeTo: number;
  nextFolio: number;
  reservedFolios: number[];
  usedFolios: number[];
};

