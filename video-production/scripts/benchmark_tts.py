#!/usr/bin/env python3
"""Manual offline benchmark after operator-approved installation. Never prints copy."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import uuid

from production import ROOT, ConfigError, write_json
from tts_contract import normalize_tts
from tts_provider import inspect_wav, prepare_tts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--text-file', type=Path, required=True, help='Private UTF-8 narration file; operator-only input.')
    parser.add_argument('--voice', default='es-male-1')
    parser.add_argument('--speed', type=float, default=1.0)
    args = parser.parse_args()
    if args.text_file.stat().st_size > 10000:
        from tts_contract import reject
        reject()
    text = ' '.join(args.text_file.read_text(encoding='utf-8').strip().splitlines())
    tts = normalize_tts({'enabled': True, 'text': text, 'voice': args.voice, 'speed': args.speed})
    os.umask(0o077)
    out = ROOT / 'outputs' / ('tts-benchmark-' + uuid.uuid4().hex)
    out.mkdir(parents=True, mode=0o700)
    c = {'audio': {'tts': tts, 'music': False, 'duckMusicDuringVoice': True}, 'timing': {'total': 120}}
    started = time.monotonic()
    metadata = prepare_tts(c, {'speech': []}, out)
    properties = inspect_wav(out / 'audio-work/narration.wav')
    elapsed = time.monotonic() - started
    report = {'chars': len(tts['text']), 'durationSeconds': properties['durationSeconds'],
              'synthesisSeconds': metadata['voiceInferenceSeconds'],
              'realtimeFactor': metadata['voiceInferenceSeconds'] / properties['durationSeconds'],
              'wallSeconds': elapsed, 'peakRssKiB': metadata.get('voicePeakRssKiB'),
              'provider': metadata['voiceProvider'], 'model': metadata['voiceModel'],
              'voice': metadata['voiceAlias'], 'speed': tts['speed'], 'wav': properties,
              'textSha256': metadata['voiceTextSha256']}
    write_json(out / 'benchmark.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except ConfigError as exc:
        print(exc.code, file=sys.stderr)
        sys.exit(2)
    except (OSError, UnicodeError, ValueError):
        print('TTS_INVALID_CONFIG', file=sys.stderr)
        sys.exit(2)
