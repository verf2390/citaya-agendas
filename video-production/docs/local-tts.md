# CIT-128 — local narration pipeline

CIT-128 adds optional local narration to Video Studio without changing the public renderer contract. The selected engine is **Resemble AI Chatterbox Multilingual V3, LatAm Spanish**, running locally on CPU.

## Contract

```json
{
  "audio": {
    "music": true,
    "sfx": true,
    "duckMusicDuringVoice": true,
    "tts": {
      "enabled": true,
      "text": "Conoce nuestro trabajo. Reserva tu hora.",
      "voice": "es-male-1",
      "speed": 1.0,
      "start": 0
    }
  }
}
```

Both config schemas close the TTS object to these fields. Narration is plain text only, maximum 1200 characters. HTML/SSML, URLs, filesystem paths, controls, credential-like strings and command/instruction markers are rejected. `voice` is the code-owned alias `es-male-1`; `speed` is 0.90–1.10; `start` must fit the video timeline. Tenants cannot choose model paths, URLs, seeds or prompt-style controls.

Explicit narration in a brief is recognized from line-anchored `LOCUCIÓN:`, `LOCUCION:`, `NARRACIÓN:`, `NARRACION:` and `VOICEOVER:`. `VOZ:` is style metadata, never narration. Existing recorded voiceover and generated TTS cannot silently overlap.

## Runtime

The active operator-installed runtime is:

```text
/home/verf/apps/citaya-chatterbox-runtime
```

It is self-contained and private to the operator account. The active Hugging Face cache is:

```text
/home/verf/apps/citaya-chatterbox-runtime/hf-home/hub
```

Required local assets include:

- `.venv/bin/python`
- `space/chatterbox/src/chatterbox/tts.py`
- `benchmarks/es_mx_f1.wav`
- local Chatterbox model snapshots under `hf-home/hub`

The provider has no download or cloud fallback. Inference runs in a separate Python process with `-I`, a minimal environment, Hugging Face/Transformers offline flags, an isolated token path, and Linux seccomp network denial before Torch/Chatterbox imports. Missing runtime assets fail closed.

The runtime directory is approximately 4.7 GB on the validated host. The selected LatAm model cache is approximately 3.0 GB. The runtime root is mode 0700.

## Voice generation

The code-owned model label emitted to safe metadata is:

```text
chatterbox-es-mx-latam-v3
```

Chatterbox is invoked with the fixed LatAm reference voice and fixed generation controls:

- language: `es`
- exaggeration: `0.5`
- temperature: `0.8`
- cfg weight: `0.5`

Narration longer than the engine's per-call limit is split without truncation at sentence/word boundaries. The same approved reference audio is applied to every chunk so long narration does not intentionally switch speakers between chunks. Chunks are concatenated locally before the normal CIT-128 duration gate.

Configured `speed` is applied after synthesis with FFmpeg `atempo`; the system never silently changes speed to force a fit.

## Pipeline and privacy

```text
explicit narration
→ closed config validation
→ private per-job audio-work
→ local Chatterbox subprocess
→ measured PCM WAV
→ duration / overlap gates
→ existing speech mixer
→ 48 kHz stereo master.wav
→ existing preview/final renderer
```

Generated narration is written as `<job>/audio-work/narration.wav` with mode 0600; `audio-work` is 0700. Symlinks, hardlinks, malformed/truncated/silent WAVs and unsafe provider metadata fail validation. No shared tenant narration cache exists.

Safe metadata includes provider/model/alias, measured duration, sample rate, inference time, speed, optional peak RSS and SHA-256 of the narration text. Narration text and internal runtime paths are not written to public render metadata.

The mixer preserves the existing filters: high-pass at 80 Hz, voice loudness normalization, music normalization, speech-band spectral carve, speech-driven ducking, SFX and final limiter. Output remains PCM16 48 kHz stereo `master.wav`.

## Commercial-copy safety

Generic fixtures must not supply real-client commercial claims. The modern local-business example therefore contains no default `offer`, `price` or `featureLabels`.

When the Video Director receives a replacement creative brief, stale optional commercial copy from the prior project is removed before direction. Existing optional commercial copy is preserved only when the brief itself is not being replaced. This prevents example or previous-client prices/offers from leaking into a newly directed advert.

## Verified evidence — 2026-10-08

TTS-focused regression suite after the Chatterbox integration:

```text
Ran 41 tests
OK
```

Commercial-copy / Director regression suite:

```text
Ran 33 tests
OK
```

Real provider benchmark on the validated CPU host successfully loaded the self-contained runtime and exited 0. `/usr/bin/time -v` reported:

- maximum resident set: 6,842,992 KiB
- swap: 0
- socket messages sent: 0
- socket messages received: 0
- elapsed wall time: 2:31.45

An earlier real pipeline run measured the approved HDR narration at 14.16 s, 24 kHz mono, and produced a 20.00 s PCM16 48 kHz stereo master. A full local preview completed successfully and generated `final.mp4`. These artifacts remain local and ignored by Git.

The full preview also exposed a stale demo-price bug in the generic fixture. That bug was removed and covered by regression tests before this document was updated.

## Licensing and voice rights

The selected Resemble AI Chatterbox code/model and the dedicated LatAm Spanish model are published upstream under the MIT license as verified during integration. Preserve upstream license notices when required by distribution.

License permission does not grant rights to imitate a particular person's voice. Any future custom reference voice must have appropriate authorization/consent for the intended use.

## Operational limitations

- CPU synthesis is quality-first, not realtime; the validated host used about 6.5 GiB peak RSS and took minutes for a short narration including model startup.
- Chatterbox and the visual Qwen worker should remain sequential on the current 16 GB host rather than intentionally overlapping their peak memory use.
- TTS duration is measured after synthesis. If narration exceeds the configured video timeline, generation fails with `TTS_DURATION_EXCEEDS_VIDEO`; the pipeline does not truncate speech or silently stretch the video.
- Recorded voiceover remains supported independently of TTS. Background scene videos are muted by the renderer; creator intro/outro audio follows the existing `useClipAudio` contract.
