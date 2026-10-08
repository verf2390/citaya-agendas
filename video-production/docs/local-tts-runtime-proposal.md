# CIT-128 — selected local TTS runtime

Status: **installed and validated on 2026-10-08**.

## Selected engine

CIT-128 uses **Resemble AI Chatterbox Multilingual V3 — LatAm Spanish** for generated narration. Piper and Kokoro were evaluated during selection but are not the active provider.

Active path:

```text
/home/verf/apps/citaya-chatterbox-runtime
```

Active model cache:

```text
/home/verf/apps/citaya-chatterbox-runtime/hf-home/hub
```

The runtime is operator-owned, outside Git, and not tenant configurable. It contains its isolated Python environment, the Chatterbox source used by the integration, the local voice reference and local model snapshots.

## Selection evidence

Three CPU candidates were auditioned on the same host:

| Engine | Result |
| --- | --- |
| Piper `es_MX-claude-high` | Fast and light, but rejected for voice quality as too robotic for the target ads. |
| Kokoro `em_alex` | Noticeably more natural than Piper, but not the preferred voice. |
| Chatterbox LatAm Spanish | Preferred in owner listening and selected for CIT-128. |

The active Chatterbox integration prioritizes voice quality over realtime latency.

Verified active-runtime benchmark on 2026-10-08:

- exit status 0
- maximum resident set: 6,842,992 KiB
- swap: 0
- socket messages sent/received: 0/0
- wall time including process/model startup: 2:31.45

The runtime directory is approximately 4.7 GB; the dedicated LatAm model cache is approximately 3.0 GB.

## Isolation

At synthesis time the provider sets Hugging Face and Transformers to offline mode and points their cache at the runtime-owned `hf-home/hub`. It also points token lookup at a nonexistent runtime-local token path and disables implicit token use.

The child establishes Linux seccomp network denial before importing Torch/Chatterbox. There is no HTTP TTS service, cloud fallback, downloader, tenant-supplied model path or persistent speech queue.

Narration enters on stdin rather than argv. Generated WAVs stay in the private per-job directory.

## Model behavior

The public alias remains `es-male-1`; tenants do not receive direct access to Chatterbox internals.

Fixed generation controls:

```text
language_id = es
exaggeration = 0.5
temperature = 0.8
cfg_weight = 0.5
```

The local `es_mx_f1.wav` reference is applied to every text chunk. The TTS contract supports up to 1200 characters; the runner splits text into chunks of at most 300 characters without truncating narration.

## Reproducibility / acquisition

The current runtime was promoted from the explicitly evaluated local environment after successful owner audition and end-to-end Video Studio testing. Model snapshots were copied into the runtime-owned Hugging Face cache so inference no longer depends on the user's global Hugging Face cache.

This repository intentionally does **not** contain the model weights, reference WAV or Python virtual environment. Do not commit those assets.

If this runtime must be rebuilt on another host, create a fresh reviewed installation procedure for the exact upstream revision and dependency set rather than treating the legacy Piper requirements file as a Chatterbox installer.

## Licensing

The selected Chatterbox repositories/model cards identify the code/model as MIT licensed. Preserve applicable upstream notices. Separately, only use custom voice references for which the operator/client has the necessary permission or consent.
