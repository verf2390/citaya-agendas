import { require } from "./dte-ts-loader.mjs";
const {
  prepareFacturaCertificationSet,
  prepareFacturaCertificationSetReissue,
  formatCertificationSetPrepare,
  formatCertificationSetReissue,
  formatCertificationSetPrepareError,
} = require("../../lib/dte/certification/factura-certification-set-prepare.ts");
try {
  const reissue = process.env.DTE_FACTURA_CERTIFICATION_REISSUE_NUMBER;
  console.log(reissue
    ? formatCertificationSetReissue(prepareFacturaCertificationSetReissue())
    : formatCertificationSetPrepare(prepareFacturaCertificationSet()));
} catch (error) {
  console.error("status=REJECTED");
  console.error(formatCertificationSetPrepareError(error));
  process.exitCode = 1;
}
