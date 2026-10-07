#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:-/home/verf/apps/citaya-current/video-production}"
RUNTIME_ROOT="${CITAYA_VIDEO_RUNTIME_ROOT:-/home/verf/apps/citaya-video-runtime/video-production}"
DATA_ROOT="${CITAYA_VIDEO_STORAGE_ROOT:-/home/verf/apps/citaya-video-data/private}"

if [[ ! -f "$SOURCE_ROOT/backend/worker.py" || ! -f "$SOURCE_ROOT/package-lock.json" ]]; then
  echo "ERROR: Video Studio source not found at $SOURCE_ROOT" >&2
  exit 1
fi

for binary in python3 npm node ffmpeg ffprobe rsync; do
  command -v "$binary" >/dev/null 2>&1 || {
    echo "ERROR: missing dependency: $binary" >&2
    exit 1
  }
done

mkdir -p "$(dirname "$RUNTIME_ROOT")" "$DATA_ROOT"
chmod 700 "$(dirname "$RUNTIME_ROOT")" "$DATA_ROOT"

mkdir -p "$RUNTIME_ROOT"
rsync -a --delete   --exclude '.venv/'   --exclude 'node_modules/'   --exclude 'storage/'   --exclude 'inputs/.studio/'   --exclude 'outputs/'   "$SOURCE_ROOT/" "$RUNTIME_ROOT/"

if [[ ! -x "$RUNTIME_ROOT/.venv/bin/python" ]]; then
  python3 -m venv "$RUNTIME_ROOT/.venv"
fi

"$RUNTIME_ROOT/.venv/bin/pip" install --disable-pip-version-check -r "$RUNTIME_ROOT/requirements.txt"
npm ci --prefix "$RUNTIME_ROOT"

mkdir -p   "$RUNTIME_ROOT/storage/staging"   "$RUNTIME_ROOT/inputs/.studio"   "$RUNTIME_ROOT/outputs"

chmod 700   "$RUNTIME_ROOT/storage"   "$RUNTIME_ROOT/storage/staging"   "$RUNTIME_ROOT/inputs/.studio"   "$RUNTIME_ROOT/outputs"   "$DATA_ROOT"

"$RUNTIME_ROOT/.venv/bin/python" -m py_compile   "$RUNTIME_ROOT/backend/"*.py   "$RUNTIME_ROOT/scripts/"*.py

test -x "$RUNTIME_ROOT/node_modules/.bin/hyperframes"

echo "CITAYA VIDEO RUNTIME READY"
echo "runtime=$RUNTIME_ROOT"
echo "storage=$DATA_ROOT"
echo "python=$RUNTIME_ROOT/.venv/bin/python"
