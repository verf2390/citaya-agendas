import { require } from "./dte-ts-loader.mjs";
const {
  runFacturaBooksDryRun,
  formatFacturaBooksDryRunResult,
  prepareRealSalesBook,
  submitPreparedRealSalesBook,
  formatRealSalesBookResult,
  prepareRealSalesBookCorrection,
  submitPreparedRealSalesBookCorrection,
  formatSalesBookCorrectionResult,
  submitSalesBookCorrectionDeliveryAttempt002,
  formatDeliveryAttempt002Result,
  prepareRealPurchaseBook,
  submitPreparedRealPurchaseBook,
  formatPurchaseBookResult,
  submitPurchaseBookDeliveryAttempt002,
  formatPurchaseDeliveryAttempt002Result,
} = require("../../lib/dte/certification/factura-books-dry-run.ts");
const args = new Set(process.argv.slice(2));
try {
  if (args.has("--real-sales-book-preflight")) console.log(formatRealSalesBookResult(prepareRealSalesBook()));
  else if (args.has("--real-sales-book-submit")) console.log(formatRealSalesBookResult(await submitPreparedRealSalesBook()));
  else if (args.has("--sales-book-correction-001-preflight")) console.log(formatSalesBookCorrectionResult(await prepareRealSalesBookCorrection()));
  else if (args.has("--sales-book-correction-001-submit")) console.log(formatSalesBookCorrectionResult(await submitPreparedRealSalesBookCorrection()));
  else if (args.has("--sales-book-correction-001-delivery-attempt-002")) console.log(formatDeliveryAttempt002Result(await submitSalesBookCorrectionDeliveryAttempt002()));
  else if (args.has("--real-purchase-book-preflight")) console.log(formatPurchaseBookResult(await prepareRealPurchaseBook()));
  else if (args.has("--real-purchase-book-submit")) console.log(formatPurchaseBookResult(await submitPreparedRealPurchaseBook()));
  else if (args.has("--purchase-book-delivery-attempt-002")) console.log(formatPurchaseDeliveryAttempt002Result(await submitPurchaseBookDeliveryAttempt002()));
  else console.log(formatFacturaBooksDryRunResult(runFacturaBooksDryRun()));
}
catch (error) { console.error("status=failed"); console.error("stage=pre_caf_10_books_dry_run"); console.error(`error=${error instanceof Error ? error.message : "unknown"}`); process.exitCode = 1; }
