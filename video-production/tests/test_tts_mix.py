"""Real FFmpeg mixing and worker/entrypoint boundaries, with a test-only TTS."""
import contextlib
import copy
import importlib.util
import io
import json
import math
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
import uuid
import wave
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'scripts'), str(ROOT/'backend'), str(ROOT/'tests')]
from production import ConfigError, validate, read_json
from compose import compile_composition
from tts_contract import apply_brief_narration
from tts_provider import prepare_tts
from fake_tts import FakeTTSProvider
from test_tts_provider import config
import audio_mix
import worker
from studio import Studio, Actor


def generator():
    spec = importlib.util.spec_from_file_location('generate_tts_test', ROOT/'scripts/generate-video.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class MixTests(unittest.TestCase):
    def mix(self, raw=None, provider=None):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        out = Path(temp.name)
        c, _, ctx = validate(raw or config())
        prepare_tts(c, ctx, out, provider or FakeTTSProvider())
        comp, _ = compile_composition(c, ctx, out, 'preview')
        with patch.object(audio_mix, 'process', wraps=audio_mix.process) as process:
            audio_mix.mix_audio(c, ctx, out, comp)
        return c, ctx, out, comp, process

    def test_same_speech_pipeline_and_safe_metadata(self):
        c, ctx, out, comp, process = self.mix()
        calls = [list(map(str, call.args[0])) for call in process.call_args_list]
        voice_call = next(call for call in calls if 'highpass=f=80,loudnorm=I=-16:TP=-2:LRA=7' in call)
        self.assertNotIn('-t', voice_call)  # no truncating generated voice
        self.assertIn(str(out/'audio-work/narration.wav'), voice_call)
        script = (out/'audio-work/mix.ffscript').read_text()
        for expected in ['loudnorm=I=-20:TP=-2:LRA=9', 'split=250 3200', 'release=650', 'release=700', 'volume=0.18', 'alimiter=limit=0.8913', 'adelay=0|0']:
            self.assertIn(expected, script)
        self.assertEqual(script.count('acrossover='), 1)
        with wave.open(str(comp/'assets/master.wav')) as wav:
            self.assertEqual((wav.getframerate(), wav.getnchannels()), (48000, 2))
            self.assertAlmostEqual(wav.getnframes()/wav.getframerate(), 10, places=3)
        meta = read_json(out/'audio-metadata.json')
        self.assertTrue(meta['ducking']); self.assertTrue(meta['spectralCarve'])
        self.assertEqual(meta['voiceModel'], 'test-tone-v1')
        self.assertEqual(meta['speechSegments'], [{'start': 0.0, 'duration': 3.0}])
        self.assertNotIn(c['audio']['tts']['text'], json.dumps(meta))
        self.assertNotIn(str(out), json.dumps(meta))
        self.assertIn('assets/master.wav', (comp/'index.html').read_text())

    def test_mixer_rejects_enabled_tts_without_synthesis(self):
        c, _, ctx = validate(config())
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ConfigError) as error:
                audio_mix.mix_audio(c, ctx, Path(d), Path(d))
        self.assertEqual(error.exception.code, 'TTS_SYNTHESIS_FAILED')

    def test_no_music_no_sfx_still_produces_master(self):
        raw = config(); raw['audio'].update(music=False, sfx=False)
        _, _, out, comp, _ = self.mix(raw)
        meta = read_json(out/'audio-metadata.json')
        self.assertIsNone(meta['ducking']); self.assertIsNone(meta['spectralCarve'])
        self.assertTrue((comp/'assets/master.wav').is_file())
        self.assertNotIn('sidechaincompress', (out/'audio-work/mix.ffscript').read_text())

    def test_recorded_voiceover_still_uses_original_trim_and_filters(self):
        raw = config(); raw['audio'].pop('tts')
        raw['media']['clientVoiceover'] = 'inputs/test-fixtures/voice.wav'
        raw['creator'] = {'voiceoverStart': 2}
        _, ctx, out, comp, process = self.mix(raw)
        self.assertEqual(ctx['speech'][0]['start'], 2)
        call = next(call.args[0] for call in process.call_args_list if '-ss' in call.args[0])
        self.assertIn('-t', call)
        self.assertEqual(read_json(out/'audio-metadata.json')['voiceProvider'], None)
        self.assertTrue((comp/'assets/master.wav').is_file())

    def test_disabled_tts_pcm_and_metadata_equal_absent(self):
        raw = config(); raw['audio'].pop('tts')
        _, _, out1, comp1, _ = self.mix(raw)
        raw['audio']['tts'] = {'enabled': False}
        _, _, out2, comp2, _ = self.mix(raw)
        self.assertEqual((comp1/'assets/master.wav').read_bytes(), (comp2/'assets/master.wav').read_bytes())
        self.assertEqual(read_json(out1/'audio-metadata.json'), read_json(out2/'audio-metadata.json'))
        self.assertEqual((comp1/'index.html').read_bytes(), (comp2/'index.html').read_bytes())

    def test_actual_ducking_recovers_during_pause(self):
        # Isolate the bed's 173 Hz component from the fake voice at 440 Hz.
        with tempfile.TemporaryDirectory(dir=ROOT/'inputs', prefix='tts-mix-test-') as d:
            bed = Path(d)/'bed.wav'; rate = 48000
            with wave.open(str(bed), 'wb') as wav:
                wav.setparams((1, 2, rate, rate*10, 'NONE', 'not compressed'))
                wav.writeframes(struct.pack('<'+'h'*(rate*10), *[round(5000*math.sin(2*math.pi*173*i/rate)) for i in range(rate*10)]))
            raw = config(); raw['audio']['sfx'] = False; raw['audio']['tts']['start'] = 1
            raw['media']['backgroundMusic'] = str(bed.relative_to(ROOT))
            _, _, _, comp, _ = self.mix(raw, FakeTTSProvider(duration=7, pause=(2, 4.5)))
            with wave.open(str(comp/'assets/master.wav')) as wav:
                samples = struct.unpack('<'+'h'*(wav.getnframes()*2), wav.readframes(wav.getnframes()))[::2]
            def amplitude(at):
                start = round(at*rate); values = samples[start:start+rate//4]
                real = sum(v*math.cos(2*math.pi*173*(start+i)/rate) for i,v in enumerate(values))
                imag = sum(v*math.sin(2*math.pi*173*(start+i)/rate) for i,v in enumerate(values))
                return 2*math.hypot(real, imag)/len(values)
            before, under, pause = amplitude(.5), amplitude(2.3), amplitude(5)
            self.assertLess(under, before*.7, (before, under, pause))
            self.assertGreater(pause, under*1.2, (before, under, pause))

    def test_start_is_respected_in_actual_silent_bed_mix(self):
        raw = config(); raw['audio'].update(music=False,sfx=False); raw['audio']['tts']['start'] = 2
        _, _, _, comp, _ = self.mix(raw)
        with wave.open(str(comp/'assets/master.wav')) as wav:
            self.assertFalse(any(wav.readframes(48000)))
            wav.setpos(48000*2+1200)
            self.assertTrue(any(wav.readframes(2400)))


class EntrypointTests(unittest.TestCase):
    def test_brief_to_generate_prepare_real_master(self):
        raw = config(); raw['audio'].pop('tts')
        apply_brief_narration(raw, 'VOZ: joven y relajada\nLOCUCIÓN: “Conoce nuestro trabajo. Reserva tu hora.”\nCTA: Reserva')
        with tempfile.TemporaryDirectory() as d:
            source = Path(d)/'config.json'; source.write_text(json.dumps(raw))
            module = generator(); output = io.StringIO(); fake = FakeTTSProvider()
            with contextlib.redirect_stdout(output):
                module.main(['--config', str(source), '--prepare-only'], tts_provider=fake)
            job = Path(next(line[8:] for line in output.getvalue().splitlines() if line.startswith('Output: ')))
            self.addCleanup(__import__('shutil').rmtree, job)
            self.assertEqual(fake.calls[0][0], 'Conoce nuestro trabajo. Reserva tu hora.')
            self.assertEqual(read_json(job/'render-metadata.json')['status'], 'prepared')
            self.assertEqual(read_json(job/'render-metadata.json')['tts']['voiceProvider'], 'fake-tts')
            self.assertEqual(stat.S_IMODE((job/'audio-work/narration.wav').stat().st_mode), 0o600)
            self.assertTrue((job/'composition/assets/master.wav').is_file())

    def test_overlong_fails_before_renderer_or_mixer(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'config.json'; path.write_text(json.dumps(config()))
            module = generator(); output = io.StringIO()
            with contextlib.redirect_stdout(output), patch.object(module, 'compile_composition') as compile_, patch.object(module, 'mix_audio') as mix:
                with self.assertRaises(ConfigError) as error:
                    module.main(['--config', str(path), '--prepare-only'], tts_provider=FakeTTSProvider(duration=11))
                self.assertEqual(error.exception.code, 'TTS_DURATION_EXCEEDS_VIDEO')
                compile_.assert_not_called(); mix.assert_not_called()
            job = Path(next(line[8:] for line in output.getvalue().splitlines() if line.startswith('Output: ')))
            self.addCleanup(__import__('shutil').rmtree, job)
            report = read_json(job/'render-metadata.json')
            self.assertEqual(report['error'], 'TTS_DURATION_EXCEEDS_VIDEO')
            self.assertNotIn(config()['audio']['tts']['text'], json.dumps(report))

    def test_worker_records_bounded_failure_and_no_success(self):
        with tempfile.TemporaryDirectory() as d:
            studio = Studio(d); self.addCleanup(studio.close)
            actor = Actor(str(uuid.uuid4()),str(uuid.uuid4()))
            raw = config(); raw.pop('media'); raw['brand'].pop('logo')
            for scene in raw['scenes']: scene.pop('media', None); scene.pop('video', None)
            project = studio.create_project(actor, raw)
            job = studio.enqueue(actor, project, 'preview', 'tts-failure')
            exc = subprocess.CalledProcessError(2, ['private-command'], '', 'TTS_SYNTHESIS_FAILED: secret raw text must not escape')
            with patch.object(worker, 'process', side_effect=exc): self.assertTrue(worker.run_one(studio, 'test'))
            row = dict(studio.db.execute('SELECT * FROM video_jobs WHERE id=?', (job,)).fetchone())
            self.assertEqual(row['status'], 'failed')
            self.assertEqual(row['error_code'], 'TTS_SYNTHESIS_FAILED')
            self.assertEqual(studio.db.execute('SELECT count(*) FROM video_outputs').fetchone()[0], 0)


if __name__ == '__main__': unittest.main()
