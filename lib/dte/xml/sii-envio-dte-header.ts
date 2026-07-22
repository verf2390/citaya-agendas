export const SII_ENVIO_DTE_XML_DECLARATION =
  '<?xml version="1.0" encoding="ISO-8859-1"?>';
export const SII_ENVIO_DTE_ROOT_OPENING =
  '<EnvioDTE xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd" version="1.0">';
export const SII_ENVIO_DTE_REQUIRED_HEADER =
  `${SII_ENVIO_DTE_XML_DECLARATION}\n${SII_ENVIO_DTE_ROOT_OPENING}`;

export function hasRequiredSiiEnvioDteHeader(xml: string): boolean {
  return xml.startsWith(`${SII_ENVIO_DTE_REQUIRED_HEADER}\n`);
}
