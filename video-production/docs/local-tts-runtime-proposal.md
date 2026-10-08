# Proposed local TTS runtime — NOT installed

This is an installation proposal, not an executed runbook. No engine, wheel or model was downloaded during CIT-128. Only official documentation and package/file metadata were inspected. Installation requires the owner's explicit approval, as requested in the task.

## Recommendation and inspected host

Use **Piper 1.8.0**, CPU ONNX inference, model **`es_MX-claude-high`**, its single speaker (no configurable speaker ID), exposed solely as **`es-male-1`**. The model card specifies Mexican Spanish, one speaker and 22,050 Hz. This is the candidate for the masculine Latin Spanish pilot; its perceived gender/age, relaxed delivery and naturalness still need an actual audition after approval. We have not heard this runtime's output. [Official Piper package](https://pypi.org/project/piper-tts/1.8.0/), [official voice card](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_MX/claude/high/MODEL_CARD).

Inspected host: Ubuntu 24.04.3 x86_64, Python 3.12.3, Intel i5-8400T (6 CPU cores), approximately 16 GB RAM with 12 GB available at inspection. FFmpeg, ffprobe and libseccomp are already present. No Piper runtime/model is installed. No GPU is required. Inference is one isolated process per existing render job, without a permanent service.

Piper is preferred for this initial single-voice job because it uses a small voice-specific ONNX file and avoids a PyTorch stack. Kokoro-82M is a credible alternative with Apache-2.0 weights and Spanish male aliases `em_alex`/`em_santa`, but its standard weights are about 327 MB plus a voice file and its normal Python stack is larger. Neither engine was installed for comparison; there is no measured quality or startup ranking. [Kokoro model](https://huggingface.co/hexgrad/Kokoro-82M), [voice list](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md).

## Licenses

- Piper 1.8.0 declares **GPL-3.0-or-later**. Use the separate runtime and preserve its notices/source obligations if distributing it. [Package license](https://pypi.org/project/piper-tts/1.8.0/).
- The Piper voice collection declares **MIT**; this specific voice's model card separately lists **Apache-2.0 for its dataset**. These are distinct declarations: do not describe the engine or all voice assets as simply MIT. The card does not separately spell out a weight-specific license. Preserve the upstream card and verify that provenance is acceptable before any later redistribution. [Collection](https://huggingface.co/rhasspy/piper-voices/blob/main/README.md), [specific card](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_MX/claude/high/MODEL_CARD).

## Exact proposed downloads

Model repository revision: `c10ece1aade47bb51c153c893d14e5bf8e5b7117`.
Source directory: `rhasspy/piper-voices/es/es_MX/claude/high` on Hugging Face.

| File | Bytes |
| --- | ---: |
| es_MX-claude-high.onnx | 63,122,309 |
| es_MX-claude-high.onnx.json | 4,963 |
| MODEL_CARD | 247 |
| **Voice total** | **63,127,519** |

Model SHA-256: `3ef40a71ea63852cd8ab7e6fa7d2ecdcfa67a0b47c9c48e3f10e02ee02083ea0`; the provider checks it before inference. [Official files](https://huggingface.co/rhasspy/piper-voices/tree/c10ece1aade47bb51c153c893d14e5bf8e5b7117/es/es_MX/claude/high).

Pinned wheels for CPython 3.12 / Linux x86_64 (hashes in [tts-runtime-requirements.txt](tts-runtime-requirements.txt)):

| Wheel | Bytes |
| --- | ---: |
| piper_tts-1.8.0-cp39-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.manylinux_2_28_x86_64.whl | 34,131,442 |
| onnxruntime-1.30.0-cp312-cp312-manylinux_2_28_x86_64.whl | 23,585,654 |
| pathvalidate-3.3.1-py3-none-any.whl | 24,305 |
| numpy-2.5.3-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl | 16,717,410 |
| flatbuffers-25.12.19-py2.py3-none-any.whl | 26,661 |
| packaging-26.3-py3-none-any.whl | 129,956 |
| protobuf-7.36.2-cp310-abi3-manylinux2014_x86_64.whl | 343,223 |
| **Wheel total** | **74,958,651** |

Total payload: **138,086,170 bytes (138.09 MB / 131.69 MiB)**, excluding index metadata and HTTP overhead. Versions, sizes and wheel hashes were read from PyPI's version JSON endpoints on 2026-10-08; no wheels were fetched. Dependencies are Piper, ONNX Runtime CPU, pathvalidate, NumPy, flatbuffers, packaging and protobuf; no training, HTTP, alignment or GPU extras. Standard Python `venv`, existing libseccomp and existing FFmpeg complete the runtime.

Planning estimates, not measurements: **0.3–1.0 GB peak RAM** per synthesis process and **250–400 MB installed disk**. Reserve 1 GB RAM until the actual benchmark reports RSS. The benchmark will include Python/model startup in synthesis time. No latency or realtime-factor promise is made before measuring.

## Exact installation commands proposed after approval

Run from this repository's root. These commands have **not** been executed:

```bash
umask 077
install -d -m 700 /home/verf/apps/citaya-tts-runtime/models
install -d -m 700 /home/verf/apps/citaya-tts-runtime/benchmarks
python3 -m venv /home/verf/apps/citaya-tts-runtime/.venv
/home/verf/apps/citaya-tts-runtime/.venv/bin/python -m pip install \
  --index-url https://pypi.org/simple --only-binary=:all: --require-hashes \
  --no-cache-dir -r video-production/docs/tts-runtime-requirements.txt

curl --fail --location --proto '=https' --tlsv1.2 \
  'https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/es/es_MX/claude/high/es_MX-claude-high.onnx' \
  --output /home/verf/apps/citaya-tts-runtime/models/es_MX-claude-high.onnx
curl --fail --location --proto '=https' --tlsv1.2 \
  'https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/es/es_MX/claude/high/es_MX-claude-high.onnx.json' \
  --output /home/verf/apps/citaya-tts-runtime/models/es_MX-claude-high.onnx.json
curl --fail --location --proto '=https' --tlsv1.2 \
  'https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/es/es_MX/claude/high/MODEL_CARD' \
  --output /home/verf/apps/citaya-tts-runtime/models/MODEL_CARD
sha256sum --check <<'SHA256'
3ef40a71ea63852cd8ab7e6fa7d2ecdcfa67a0b47c9c48e3f10e02ee02083ea0  /home/verf/apps/citaya-tts-runtime/models/es_MX-claude-high.onnx
SHA256
```

Stop if any command fails. The hash-pinned wheel plan is specific to this inspected host; a different platform requires a new reviewed plan. All acquisition happens in this explicit installation step. The inference subprocess has network syscalls denied and cannot fetch missing files. Models and runtime stay outside Git and outside application dependencies. No systemd, HTTP endpoint, public listener or Cloudflare configuration is needed.

## Benchmark after installation

Place the exact owner-provided reference narration in a private UTF-8 file at `/home/verf/apps/citaya-tts-runtime/benchmarks/hdr-narration.txt` (0600). Its text and generated WAV must not enter Git. Then run:

```bash
python3 video-production/scripts/benchmark_tts.py \
  --text-file /home/verf/apps/citaya-tts-runtime/benchmarks/hdr-narration.txt \
  --voice es-male-1 --speed 1.0
```

The script reports character count, measured duration, synthesis seconds, realtime factor, wall time, child peak RSS, provider/model/alias, speed, PCM WAV properties and narration SHA-256. It never prints narration text. Audio/report remain in a private `video-production/outputs/tts-benchmark-<uuid>/` job. Run three times to compare process-start costs, then listen to the exact narration and assess pronunciation, pauses, voice suitability and timeline fit before approving a real advert. If too long, return the explicit duration error and revise text/target duration/configured speed; no silent fitting is performed.
