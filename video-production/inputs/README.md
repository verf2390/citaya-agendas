# Video Studio inputs

Los medios reales del operador viven aqui y **no se versionan en Git**.

Recomendado: una carpeta por proyecto, por ejemplo:

```text
inputs/projects/victor-promo/
  creator-intro.mp4
  logo.png
  screenshot-home.png
  voiceover.wav
  captions.srt
```

Roles autodetectados por nombre:

- `logo.*` -> logo.
- video con `intro` / `inicio` -> creator intro.
- video con `outro` / `cierre` / `final` -> creator outro.
- audio con `voiceover` / `voice` / `voz` / `narracion` -> voz.
- audio con `music` / `musica` / `background` / `bgm` / `fondo` -> musica.
- audio con `sfx` / `effect` / `efecto` -> efecto de sonido.
- imagen con `screenshot` / `screen` / `captura` -> screenshot.
- otras imagenes -> fotos.
- otros videos -> clips visuales.
- `.srt` o `.vtt` -> subtitulos (solo uno de los dos formatos).

Formatos permitidos: PNG/JPG/JPEG/WebP, MP4/MOV/WebM, WAV/MP3/M4A/OGG, SRT/VTT.

La ingesta rechaza rutas fuera de `video-production/inputs/`, symlinks, formatos desconocidos, archivos vacios, roles singleton duplicados y audio ambiguo. Cada archivo se inspecciona antes de incorporarlo y el manifiesto conserva tamaño, resolucion/duracion cuando aplica y SHA-256.

Inspeccion sin IA ni render:

```bash
python3 video-production/scripts/ingest-media.py \
  --dir video-production/inputs/projects/victor-promo
```

Crear video desde brief + carpeta:

```bash
python3 video-production/scripts/create-from-brief.py \
  --media-dir video-production/inputs/projects/victor-promo \
  --approve-media \
  "Crea un Reel para promocionar Citaya Agendas"
```

`--approve-media` es deliberado: confirma que el operador reviso derechos de uso, privacidad y contenido. La autodeteccion tecnica nunca concede esa aprobacion.

No colocar secretos, exports de produccion ni material privado no autorizado en esta carpeta.
