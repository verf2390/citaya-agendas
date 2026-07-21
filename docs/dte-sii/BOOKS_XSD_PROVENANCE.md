# LibroCompraVenta XSD provenance

- Official SII page: https://www.sii.cl/servicios_online/3532-formato_xml-3811.html
- Official ZIP: https://www.sii.cl/factura_electronica/factura_mercado/schema_iecv.zip
- Download date: 2026-07-19
- ZIP SHA-256: `f5ae546b5cb3aa09201695562529e255aa2d2c1c59850458d37c2cf24b4cc44b`

## Extracted official files

- `LibroCV_v10.xsd`: `d38672ec612888b4f952264372afc836d5b905579d9735159fefe9ddacf167ce`
- `LceSiiTypes_v10.xsd`: `fcccac6db4de9a74e157316d46abfa3f529086f55d45e68a9974204a25d98ca2`
- `LceCal_v10.xsd`: `47378044d6dff87a9ccda7f02e338bda7665f5bcd9da1b54c79e81da5ddf5257`
- `LceCoCertif_v10.xsd`: `3fc1c20b35e916a427a4800f8bbc3616489833784372f5bce9d3c121ca9fbde8`
- `xmldsignature_v10.xsd`: `427e3225cd379ae92bae464b892dbf964665af92d453ac61774cffab38b95edb`

## Validation tools

- Primary diagnostic: `xmllint` / libxml2.
- Compatible validator: Java JAXP/Xerces executed in Docker with the official image `eclipse-temurin:21.0.5_11-jdk`.
- Docker image digest used by `npm run dte:books:xsd:check`: `sha256:d59ca4960a17035592a5c928343ba56862ea6067929da4e776d7a0f4ec26aa44`.
- Container policy: `--rm`, `--network none`, read-only mounts for `docs/dte-sii/xsd`, generated XML fixtures and the local Java validator source. No env files, certificates or secrets are mounted.

## Known xmllint limitation

`xmllint` fails to compile the official schema intact at `docs/dte-sii/xsd/LceSiiTypes_v10.xsd:34`:

```xml
<xs:maxInclusive value="999999999999999999999999999999.9999"/>
```

The observed error is that libxml2 rejects this `xs:decimal` facet value while parsing the schema. The schema is kept intact; do not normalize or patch it in this repository.
