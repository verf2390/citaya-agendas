#!/usr/bin/env python3
"""Explicit developer harness: audible test tone, NEVER selected by tenant config."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'scripts'), str(ROOT/'tests')]
from production import read_json
from tts_contract import apply_brief_narration
from fake_tts import FakeTTSProvider


def main():
    config = read_json(ROOT/'configs/examples/local-business-modern.json')
    config['audio'] = {'music': True, 'sfx': True, 'duckMusicDuringVoice': True}
    apply_brief_narration(config, 'VOZ: masculina joven-adulta\nLOCUCIÓN: “Conoce nuestro trabajo. Cada detalle cuenta. Reserva tu hora.”\nCTA: Reserva tu hora')
    spec = importlib.util.spec_from_file_location('generate_video', ROOT/'scripts/generate-video.py')
    generate = importlib.util.module_from_spec(spec); spec.loader.exec_module(generate)
    with tempfile.TemporaryDirectory() as d:
        source = Path(d)/'config.json'; source.write_text(json.dumps(config))
        generate.main(['--config', str(source), '--mode', 'preview'],
                      tts_provider=FakeTTSProvider(duration=6, pause=(2, 3.5)))


if __name__ == '__main__': main()
