#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${CITAYA_VIDEO_RUNTIME_ROOT:-/home/verf/apps/citaya-video-runtime/video-production}"
DATA_ROOT="${CITAYA_VIDEO_STORAGE_ROOT:-/home/verf/apps/citaya-video-data/private}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ -d "$RUNTIME_ROOT" ]] || fail "runtime missing: $RUNTIME_ROOT"
[[ -x "$RUNTIME_ROOT/.venv/bin/python" ]] || fail "python venv missing"
[[ -x "$RUNTIME_ROOT/node_modules/.bin/hyperframes" ]] || fail "hyperframes missing"
[[ -f "$RUNTIME_ROOT/backend/worker.py" ]] || fail "worker missing"
[[ -f "$RUNTIME_ROOT/backend/bridge.py" ]] || fail "bridge missing"
[[ -d "$DATA_ROOT" && -w "$DATA_ROOT" ]] || fail "private storage unavailable"

for binary in node ffmpeg ffprobe; do
  command -v "$binary" >/dev/null 2>&1 || fail "$binary missing"
done

"$RUNTIME_ROOT/.venv/bin/python" - <<'PY'
import jsonschema
print("python/jsonschema: OK")
PY

"$RUNTIME_ROOT/node_modules/.bin/hyperframes" --version >/dev/null

echo "VIDEO WORKER PREFLIGHT GREEN"
