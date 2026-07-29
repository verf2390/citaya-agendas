# Adquisición del trust anchor SII para CAF productivos

## Contrato

- El `IDK` del CAF identifica la llave pública del SII que verifica la firma
  `FRMA`; no contiene la llave.
- La `RSAPK` del bloque `DA` y `RSAPUBK` de `AUTORIZACION` pertenecen al
  contribuyente y nunca son un trust anchor del SII.
- Los CAF conocidos de certificación usan `IDK=100`, pero ese dato no autoriza
  a asumir, reconstruir ni sustituir la llave correspondiente.
- El formato aceptado es una llave pública que `node:crypto.createPublicKey`
  pueda parsear y exportar como SPKI, o un certificado X.509 cuyo DER sea el
  material fijado. La instalación recomendada sigue siendo PEM SPKI.
- La procedencia primaria es una URL HTTPS del dominio `sii.cl` o un
  subdominio, registrada con el prefijo `official:`. Para el certificado
  histórico `IDK=300` se admite exclusivamente la procedencia cerrada
  `historical_sii_idk300_certificate_cryptographically_cross_validated_against_3_authenticated_production_cafs`;
  requiere validación independiente de `FRMA` contra los tres CAF productivos
  autenticados y no se generaliza a ningún otro `IDK`.
- El SHA-256 completo en minúsculas debe fijarse antes de habilitar cualquier
  importación.

Las especificaciones oficiales son:

- https://www.sii.cl/factura_electronica/instructivo_emision.pdf
- https://www.sii.cl/factura_electronica/tecnica.htm

El instructivo establece que el SII entrega el CAF después de una solicitud de
folios válida, que `IDK` identifica su llave pública y que esa llave verifica la
integridad y autenticidad de `FRMA`. La revisión de esas publicaciones no
encontró una descarga oficial de la llave asociada a `IDK=100`.

## Estado controlado al 28 de julio de 2026

- Los CAF productivos 33, 56 y 61 de R&G SpA declaran `IDK=300` y sus tres
  firmas `FRMA` fueron verificadas con el mismo certificado histórico externo.
- El certificado no coincide con ninguna `RSAPK`/`RSAPUBK` del contribuyente;
  su DER y SHA-256 están fijados fuera del repositorio.
- Los tres CAF están importados como metadata tenant-scoped y los folios siguen
  disponibles. El XML CAF y las llaves permanecen sólo en almacenamiento
  externo `0600`.
- La emisión legal 33/56/61 está pausada y el flag local está cerrado hasta
  registrar `resolution_date` y `resolution_number` desde la resolución SII
  real y aplicar `202607280001_dte_sii_resolution_gate.sql`. `sii_office` es
  metadato auditable opcional: `EnvioDTE_v10.xsd` exige `FchResol` y
  `NroResol`, pero no define una oficina SII; nunca debe inferirse una.

## Procedimiento posterior a la autorización

1. Preferir una publicación HTTPS oficial del SII. No aceptar GitHub, paquetes,
   blogs, ejemplos ni llaves reconstruidas. La única excepción implementada es
   el certificado histórico `IDK=300` bajo la procedencia cerrada y triple
   validación `FRMA` descritas arriba.
2. Guardarla fuera del repositorio y fuera del laboratorio, en el directorio
   exclusivo de producción del tenant. El directorio debe ser `0700`; el
   archivo debe ser regular, sin symlink, del propietario del servicio y
   `0600`.
3. Registrar fuera de columnas públicas: URL oficial exacta, fecha de
   obtención, `IDK`, SHA-256 y responsable de la revisión.
4. Verificar offline que la llave es parseable y que valida `FRMA` en CAF
   oficiales conocidos cuyo `IDK` coincide.
5. Confirmar que la llave no coincide con la `RSAPK`/`RSAPUBK` del
   contribuyente.
6. Configurar conjuntamente IDK, ruta externa, procedencia y SHA-256. Una
   configuración parcial es inválida.
7. Importar el CAF productivo sólo después de que todas las comprobaciones
   anteriores pasen. El CAF de certificación nunca se copia ni se importa como
   productivo.

## Gates

`readyForDeclaration` requiere que este procedimiento esté implementado y que
el importador productivo opere fail-closed. No requiere disponer todavía del
anchor ni de CAF productivos.

`readyForIssuance` requiere adicionalmente el anchor oficial con SHA-256
fijado, autorización productiva del SII, CAF productivo verificado, folios
disponibles, resolución SII exacta, endpoints productivos y flags productivos
habilitados.

Ante IDK desconocido, anchor ausente, archivo inseguro, SHA incorrecto,
procedencia no oficial, confusión con RSAPK o `FRMA` inválida, la importación se
rechaza antes de persistir CAF o folios. Ante resolución SII incompleta, el
gate y el generador bloquean antes de preparar artefactos o reservar un folio.
