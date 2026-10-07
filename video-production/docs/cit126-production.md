# CIT-126 — producción local del Video Studio

La aplicación Next y el worker comparten un storage privado estable, separado de
los releases de `citaya-current`.

## Rutas de producción

- Código runtime: `/home/verf/apps/citaya-video-runtime/video-production`
- Datos privados: `/home/verf/apps/citaya-video-data/private`
- Release fuente: `/home/verf/apps/citaya-current/video-production`

El runtime evita que un cambio de symlink de release elimine o desconecte la
cola SQLite, assets u outputs.

## Preparar runtime

Desde el release ya validado:

```bash
bash /home/verf/apps/citaya-current/video-production/ops/install-runtime.sh
bash /home/verf/apps/citaya-current/video-production/ops/preflight-worker.sh
```

No copiar `.env.local` al runtime. Qwen se usa únicamente desde el bridge
server-side; las credenciales siguen en el entorno de Citaya.

## Variables de citaya.service

Agregar al entorno server-side de Next:

```
CITAYA_VIDEO_RUNTIME_ROOT=/home/verf/apps/citaya-video-runtime/video-production
CITAYA_VIDEO_PYTHON=/home/verf/apps/citaya-video-runtime/video-production/.venv/bin/python
CITAYA_VIDEO_STORAGE_ROOT=/home/verf/apps/citaya-video-data/private
CITAYA_VIDEO_UPLOAD_MAX_BYTES=250000000
```

## Worker

Instalar `ops/citaya-video-worker.service` como
`/etc/systemd/system/citaya-video-worker.service`, luego daemon-reload,
enable y start. El servicio corre como `verf`, no escucha HTTP y tiene
`PrivateNetwork=true`.

Antes de cada activación o actualización ejecutar el preflight. El worker y el
bridge deben usar exactamente el mismo `CITAYA_VIDEO_STORAGE_ROOT`.

## Gate de final

El worker puede ejecutar `--approve-final` solamente porque `Studio.enqueue`
permite encolar modo final después de que un usuario autenticado aprobó un
preview vigente. El navegador no puede saltar ese gate.
