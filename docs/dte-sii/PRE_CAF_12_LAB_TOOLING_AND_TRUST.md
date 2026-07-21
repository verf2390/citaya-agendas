# PRE-CAF 12: tooling, trust y licencias

PRE-CAF 12 es exclusivamente un laboratorio offline. MuPDF y zxing-wasm estan fijados en devDependencies y solo pueden importarse desde el generador de muestras de certificacion. La prueba tooling-import-boundary-check falla si esas dependencias aparecen en app, rutas API o librerias productivas.

MuPDF se distribuye bajo AGPL y licenciamiento comercial alternativo. Este repositorio no afirma una conclusion juridica sobre una distribucion futura: antes de desplegar o redistribuir MuPDF debe revisarse el modelo de licencia con asesoria competente. El gate solo demuestra aislamiento tecnico del tooling de laboratorio.

El trust store fixture esta fuera del CAF y fuera de Git. Un CAF real futuro exige un anchor oficial separado, procedencia official, SHA-256 externo e IDK coincidente. Hasta conocer el IDK del CAF real, el estado es pending_real_caf_idk y el modo real permanece cerrado.
