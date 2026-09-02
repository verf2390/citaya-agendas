import assert from "node:assert/strict";
import test from "node:test";

import { markFolioUsed } from "../folios/mark-folio-used";
import { releaseReservedFolio } from "../folios/release-reserved-folio";
import { reserveFolio, type DteFolioLedgerEntry } from "../folios/reserve-folio";
import {
  mapRawSiiStatus,
  mapSiiStatusToInternalStatus,
  parseSiiSubmissionResponse,
} from "../sii/sii-status";

const ledger: DteFolioLedgerEntry[] = [
  {
    tenantId: "tenant-1",
    documentType: "factura_afecta",
    folio: 1001,
    status: "available",
  },
  {
    tenantId: "tenant-1",
    documentType: "factura_afecta",
    folio: 1002,
    status: "available",
  },
];

test("reserves, releases and marks folios without reusing used folios", () => {
  const reserved = reserveFolio({
    tenantId: "tenant-1",
    documentType: "factura_afecta",
    candidateFolios: ledger,
    documentReference: "payment-1",
  });

  assert.equal(reserved.reserved.folio, 1001);
  assert.equal(reserved.reserved.status, "reserved");

  const released = releaseReservedFolio(
    reserved.ledger,
    reserved.reserved,
    "validation_failed",
  );
  assert.equal(released.released.status, "available");

  const reservedAgain = reserveFolio({
    tenantId: "tenant-1",
    documentType: "factura_afecta",
    candidateFolios: released.ledger,
    documentReference: "payment-1",
  });
  const used = markFolioUsed(reservedAgain.ledger, reservedAgain.reserved, "doc-1");
  assert.equal(used.used.status, "used");
  assert.throws(() =>
    releaseReservedFolio(used.ledger, used.used, "manual_abort"),
  );
});

test("maps SII statuses to internal statuses", () => {
  assert.equal(mapRawSiiStatus("EPR"), "accepted");
  assert.equal(mapRawSiiStatus("RCH"), "rejected");
  assert.equal(mapSiiStatusToInternalStatus("processing"), "submitted");
  assert.equal(mapSiiStatusToInternalStatus("unknown"), "failed");

  const parsed = parseSiiSubmissionResponse({ TRACKID: "123", estado: "EPR" });
  assert.equal(parsed.trackId, "123");
  assert.equal(parsed.status, "accepted");
});
