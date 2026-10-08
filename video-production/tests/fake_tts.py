"""Test-only signal generator, NOT a speech engine. Cannot be selected by config."""
import math
import struct
import time
import wave

from tts_contract import normalize_tts


class FakeTTSProvider:
    def __init__(self, duration=3.0, pause=(1.0, 2.0)):
        self.duration, self.pause = duration, pause
        self.calls = []

    def synthesize(self, text, voice, speed, output_path):
        normalize_tts({'enabled': True, 'text': text, 'voice': voice, 'speed': speed})
        self.calls.append((text, voice, speed, output_path))
        started = time.monotonic()
        rate = 24000
        samples = []
        for i in range(round(self.duration * rate)):
            t = i / rate
            envelope = 0 if self.pause[0] <= t < self.pause[1] else min(1, t * 30, (self.duration-t) * 30)
            samples.append(round(7000 * envelope * math.sin(2 * math.pi * 440 * t)))
        with wave.open(str(output_path), 'wb') as wav:
            wav.setparams((1, 2, rate, len(samples), 'NONE', 'not compressed'))
            wav.writeframes(struct.pack('<' + 'h' * len(samples), *samples))
        return {'provider': 'fake-tts', 'model': 'test-tone-v1', 'voice': voice,
                'durationSeconds': self.duration, 'sampleRate': rate,
                'inferenceSeconds': time.monotonic() - started}
