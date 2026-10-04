# Contrato para Qwen / AI local o cloud

El modelo recibe únicamente `schemas/tenant-video-config.schema.json` para autoservicio (o `video-config.schema.json` para operador interno), productos/nichos/templates permitidos, capacidades aprobadas y una lista de assets ya autorizados con ID, tipo, duración y dimensiones. No necesita el repositorio Citaya, Python, GSAP, HyperFrames ni shell. No recibe el catálogo operacional de perfiles de gates ni secretos.

Prompt base:

> Eres el asistente de contenido de CITAYA VIDEO STUDIO. Devuelve UN objeto JSON conforme al schema proporcionado, sin Markdown ni comandos. Usa sólo producto, plantilla, nicho, capacidades y assets de las listas entregadas. No escribas código de animación. No añadas tenant_id, aprobación final, rutas, URLs de medios, credenciales o datos de clientes. Para medios usa asset:<id> exactamente como fue provisto. No declares disponibles capacidades planned/in_progress. Si el usuario pide una de ellas, propone videoType roadmap/concept con CTA informativo. No inventes imágenes, precios, descuentos, testimonios ni resultados. mediaPolicy usa sólo assets proporcionados, sin stock ni generación. Deja la revisión y el render final al usuario.

Pipeline obligatorio: JSON Schema → verdad de capacidades → tenant/proyecto de cada asset → existencia/tipo/integridad → timing → revisión humana → queue. La salida AI no se ejecuta como instrucción. Las propuestas se guardan como draft; no aprueban ni generan finales.

`content` es la interfaz recomendada. `hook`, `secondaryHook`, `cta` al nivel raíz siguen disponibles para los ejemplos iniciales; si ambos lugares contienen valores distintos, se rechaza como ambiguo. `media` admite imágenes, screenshots, videos, intro/outro, una voz y música/SFX opcionales. Dos voces simultáneas se rechazan; usar una mezcla revisada o, en una futura versión, segmentos explícitos.

Un ejemplo tenant sin rutas locales:

```json
{
  "product": "custom-client-video",
  "template": "local-business-promo-v1",
  "niche": "veterinary",
  "videoType": "promotion",
  "brand": {"businessName": "Veterinaria Demo"},
  "content": {"hook": "Conoce nuestros servicios", "cta": "Conversemos"},
  "media": {"images": ["asset:00000000-0000-0000-0000-000000000123"]},
  "mediaPolicy": {"useOnlyProvidedAssets": true, "allowStockMedia": false, "allowGeneratedMedia": false},
  "mediaApproved": true
}
```

El ID del ejemplo es ilustrativo: no funciona hasta que el servidor entregue un ID real de ese tenant y proyecto. `mediaApproved` debe fijarlo el usuario tras revisar los medios, no tratar una afirmación del modelo como revisión humana. Para autoservicio, el adaptador debe controlar ese paso de revisión explícitamente antes de llamar a enqueue; la aprobación final siempre se registra en una operación separada.

## Transcripción y TTS futuros

Interfaz prevista: archivo de voz local → comando de whisper.cpp ejecutado por un adaptador confiable → SRT/VTT en staging → inspección/revisión → asset de captions. No se instala ni exige Whisper ahora. TTS local futuro produce un WAV revisable; entra por el mismo contrato de voz sin modificar animación. No hay proveedor TTS pagado obligatorio ni generación implícita de voz.
