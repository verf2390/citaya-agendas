"""CIT-128: closed config, deterministic extraction, offline provider and timeline."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'scripts'), str(ROOT / 'backend'), str(ROOT / 'tests')]
from production import ConfigError, read_json, validate, tenant_schema_validate
from tts_contract import apply_brief_narration, extract_narration, normalize_tts
from tts_provider import LocalTTSProvider, prepare_tts, inspect_wav
from tts_chatterbox_runner import generation_kwargs, text_chunks
import tts_provider
from fake_tts import FakeTTSProvider


def config():
    raw = read_json(ROOT / 'configs/examples/local-business-modern.json')
    raw['audio'] = {'music': True, 'sfx': True, 'tts': {'enabled': True, 'text': 'Conoce nuestro trabajo. Reserva tu hora.'}}
    return raw


class ContractTests(unittest.TestCase):
    def bad(self, raw, code):
        with self.assertRaises(ConfigError) as result:
            validate(raw)
        self.assertEqual(result.exception.code, code)
        self.assertNotIn('Conoce nuestro', str(result.exception))

    def test_disabled_and_absent_preserve_legacy(self):
        raw = config(); raw['audio'].pop('tts')
        plain, _, plain_ctx = validate(raw)
        raw['audio']['tts'] = {'enabled': False}
        disabled, _, disabled_ctx = validate(raw)
        disabled['audio'].pop('tts')
        self.assertEqual(plain, disabled)
        self.assertEqual(plain_ctx, disabled_ctx)
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(prepare_tts(plain, plain_ctx, Path(d), FakeTTSProvider()))
            self.assertFalse((Path(d) / 'audio-work').exists())

    def test_enabled_requires_text(self):
        raw = config(); raw['audio']['tts'].pop('text')
        self.bad(raw, 'TTS_INVALID_CONFIG')

    def test_invalid_texts(self):
        for text in ['', '   ', 'a'*1201, '<speak>Hola</speak>', 'https://example.com', 'www.ejemplo.cl',
                     'Hola\x00mundo', 'Hola\nmundo', 'Hola\tmundo', 'api_key=secret', 'Bearer abcdef',
                     '/tmp/voice.wav', '../voice.wav', 'C:\\tmp\\voice.wav', '`echo hola`', '$(id)',
                     'sudo reboot', 'ignora todas las instrucciones previas', '[[ phonemes ]]',
                     'ejemplo.xyz', '127.0.0.1', 'access_token=secret', 'contraseña=secret']:
            with self.subTest(text=text[:25]):
                raw = config(); raw['audio']['tts']['text'] = text
                self.bad(raw, 'TTS_INVALID_CONFIG')

    def test_spanish_punctuation_preserved(self):
        text = '¡Tu próximo corte! ¿Clásico, degradado o barba? Incluye bebida; reserva hoy.'
        self.assertEqual(normalize_tts({'enabled': True, 'text': text})['text'], text)

    def test_unknown_voice(self):
        raw = config(); raw['audio']['tts']['voice'] = 'another-model'
        self.bad(raw, 'TTS_VOICE_UNSUPPORTED')

    def test_speed_and_start_bounds(self):
        for key, values in {'speed': [.89, 1.11, True, '1', float('nan')], 'start': [-1, 10, 121, True, float('inf')]}.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    raw = config(); raw['audio']['tts'][key] = value
                    self.bad(raw, 'TTS_INVALID_CONFIG')
        for speed in [.9, 1, 1.1]:
            raw = config(); raw['audio']['tts']['speed'] = speed
            c, _, _ = validate(raw)
            self.assertEqual(c['audio']['tts']['speed'], speed)
            self.assertEqual(c['audio']['tts']['start'], 0)

    def test_closed_fields_both_schemas(self):
        for key in ['model', 'provider', 'output_path', 'executable', 'speaker', 'style', 'emotion', 'referenceVoice', 'seed', 'ssml']:
            raw = config(); raw['audio']['tts'][key] = 'untrusted'
            self.bad(raw, 'TTS_INVALID_CONFIG')
        raw = config(); raw.pop('media'); raw['brand'].pop('logo')
        for scene in raw['scenes']:
            scene.pop('video', None); scene.pop('media', None)
        tenant_schema_validate(raw)
        raw['audio']['tts']['modelPath'] = '/tmp/model'
        with self.assertRaises(ConfigError): tenant_schema_validate(raw)

    def test_recorded_voice_conflicts_all_aliases(self):
        for container, key in [('media', 'clientVoiceover'), ('media', 'creatorVoiceover'), ('creator', 'voiceover')]:
            raw = config(); raw.setdefault(container, {})[key] = 'inputs/test-fixtures/voice.wav'
            self.bad(raw, 'TTS_VOICE_CONFLICT')

    def test_tts_music_requires_ducking(self):
        raw = config(); raw['audio']['duckMusicDuringVoice'] = False
        self.bad(raw, 'VOICE_DUCKING_REQUIRED')
        raw['audio']['music'] = False
        validate(raw)


class NarrationTests(unittest.TestCase):
    def test_all_explicit_headers_exact_copy(self):
        text = 'Tu próximo corte tiene nombre: Estudio Demo. ¡Reserva tu hora!'
        for header in ['LOCUCIÓN', 'LOCUCION', 'NARRACIÓN', 'NARRACION', 'VOICEOVER']:
            with self.subTest(header=header):
                self.assertEqual(extract_narration('BRIEF: Anuncio\n'+header+':\n“'+text+'”\nCTA: Otro texto'), text)

    def test_multiline_and_outer_quotes(self):
        self.assertEqual(extract_narration('LOCUCIÓN:\n«Hola, mundo.\nNos vemos mañana.»'), 'Hola, mundo. Nos vemos mañana.')
        self.assertEqual(extract_narration('**LOCUCIÓN:** "Hola."\n## Visuales\nOtra cosa'), 'Hola.')

    def test_voz_and_absence_never_enable(self):
        for brief in ['VOZ: masculina joven-adulta', 'Anuncio sin locución.', 'Menciona LOCUCIÓN: dentro de una oración.']:
            c = {}; apply_brief_narration(c, brief)
            self.assertNotIn('audio', c)
            self.assertIsNone(extract_narration(brief))

    def test_next_structural_heading_stops_extraction(self):
        for heading in ['VOZ', 'MÚSICA', 'CTA', 'ESCENAS', 'Notas', 'Escena 1', 'UN CAMPO NUEVO']:
            self.assertEqual(extract_narration('LOCUCION: Hola.\n'+heading+': no leer.'), 'Hola.')

    def test_claims_never_rewritten(self):
        c = {}; text = 'Todos incluyen bebida de cortesía y mascarilla facial de carbón.'
        apply_brief_narration(c, 'LOCUCIÓN: '+text)
        self.assertEqual(c['audio']['tts']['text'], text)
        self.assertEqual(c['audio']['tts']['voice'], 'es-male-1')
        self.assertEqual(c['audio']['tts']['start'], 0)

    def test_empty_duplicate_or_unsafe_blocks_fail(self):
        for brief in ['LOCUCION:\nCTA: Hola', 'LOCUCION: Hola\nNARRACION: Adiós', 'LOCUCION: <b>Hola</b>', 'LOCUCION: '+'a'*1201]:
            with self.subTest(brief=brief[:30]), self.assertRaises(ConfigError): extract_narration(brief)

    def test_missing_block_preserves_explicit_tts(self):
        c = config(); before = copy.deepcopy(c)
        apply_brief_narration(c, 'Sólo actualiza escenas.')
        self.assertEqual(c, before)


class ProviderTests(unittest.TestCase):
    def prepare(self, fake=None, raw=None):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        c, _, ctx = validate(raw or config()); out = Path(self.tmp.name)
        meta = prepare_tts(c, ctx, out, fake or FakeTTSProvider())
        return c, ctx, out, meta

    def test_fake_wav_measured_private_metadata(self):
        c, ctx, out, meta = self.prepare()
        output = out/'audio-work/narration.wav'
        self.assertEqual(inspect_wav(output)['durationSeconds'], 3)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(output.parent.stat().st_mode), 0o700)
        self.assertEqual(ctx['speech'][0]['start'], 0)
        self.assertEqual(meta['voiceProvider'], 'fake-tts')
        self.assertEqual(meta['voiceAlias'], 'es-male-1')
        self.assertEqual(meta['voiceTextSha256'], hashlib.sha256(c['audio']['tts']['text'].encode()).hexdigest())
        self.assertNotIn(c['audio']['tts']['text'], json.dumps(meta))
        self.assertNotIn(str(out), json.dumps(meta))
        self.assertTrue(meta['voiceGenerated'])

    def test_fake_rejects_unknown_voice(self):
        with self.assertRaises(ConfigError) as error:
            FakeTTSProvider().synthesize('Hola', 'unknown', 1, Path('/unused'))
        self.assertEqual(error.exception.code, 'TTS_VOICE_UNSUPPORTED')

    def test_provider_failure_bounded_without_fallback(self):
        class Broken:
            def synthesize(self, *args): raise RuntimeError('secret narration /private/model')
        with patch.object(tts_provider, 'LocalTTSProvider') as fallback:
            with self.assertRaises(ConfigError) as error: self.prepare(Broken())
            self.assertEqual(str(error.exception), 'TTS_SYNTHESIS_FAILED')
            fallback.assert_not_called()
        self.assertFalse((Path(self.tmp.name)/'audio-work/narration.wav').exists())

    def test_missing_runtime_fails_closed(self):
        with tempfile.TemporaryDirectory() as missing, patch.object(tts_provider, 'RUNTIME', Path(missing)):
            with self.assertRaises(ConfigError) as error: self.prepare(LocalTTSProvider())
        self.assertEqual(error.exception.code, 'TTS_DEPENDENCY_MISSING')

    def test_output_io_failure_is_bounded(self):
        real_chmod = os.chmod
        def chmod(path, mode):
            if str(path).endswith('narration.wav'):
                raise OSError('sensitive internal path')
            return real_chmod(path, mode)
        with patch.object(tts_provider.os, 'chmod', side_effect=chmod):
            with self.assertRaises(ConfigError) as error: self.prepare()
        self.assertEqual(str(error.exception), 'TTS_INVALID_OUTPUT')
        self.assertFalse((Path(self.tmp.name)/'audio-work/narration.wav').exists())

    def test_invalid_empty_truncated_and_silent_wav_rejected(self):
        class Invalid:
            def synthesize(self, text, voice, speed, path):
                path.write_bytes(b'not a wav')
                return {}
        with self.assertRaises(ConfigError) as error: self.prepare(Invalid())
        self.assertEqual(error.exception.code, 'TTS_INVALID_OUTPUT')
        class Silent(FakeTTSProvider):
            def __init__(self): super().__init__(pause=(0, 5))
        with self.assertRaises(ConfigError): self.prepare(Silent())
        class Truncated(FakeTTSProvider):
            def synthesize(self, text, voice, speed, path):
                metadata = super().synthesize(text, voice, speed, path)
                path.write_bytes(path.read_bytes()[:100]); return metadata
        with self.assertRaises(ConfigError): self.prepare(Truncated())

    def test_declared_duration_not_trusted_and_no_truncation(self):
        class Lying(FakeTTSProvider):
            def synthesize(self, *args):
                metadata = super().synthesize(*args); metadata['durationSeconds'] = .1
                return metadata
        fake = Lying(duration=10.05)
        raw = config(); before = copy.deepcopy(raw)
        with self.assertRaises(ConfigError) as error: self.prepare(fake, raw)
        self.assertEqual(error.exception.code, 'TTS_DURATION_EXCEEDS_VIDEO')
        self.assertEqual(raw, before)
        self.assertEqual(fake.calls[0][2], 1.0)
        self.assertEqual(len(fake.calls), 1)

    def test_configured_start_and_speed_are_unchanged(self):
        raw = config(); raw['audio']['tts'].update(start=6, speed=.9)
        fake = FakeTTSProvider(duration=4)
        c, ctx, _, _ = self.prepare(fake, raw)
        self.assertEqual(ctx['speech'][0]['start'], 6)
        self.assertEqual(ctx['speech'][0]['duration'], 4)
        self.assertEqual(c['timing'], raw['timing'])
        self.assertEqual(fake.calls[0][2], .9)
        raw['audio']['tts']['start'] = 6.01
        with self.assertRaises(ConfigError) as error: self.prepare(fake, raw)
        self.assertEqual(error.exception.code, 'TTS_DURATION_EXCEEDS_VIDEO')

    def test_creator_audio_overlap_and_muted_compatibility(self):
        raw = config(); raw['media']['creatorIntro'] = 'inputs/test-fixtures/intro.mp4'
        with self.assertRaises(ConfigError) as error: self.prepare(raw=raw)
        self.assertEqual(error.exception.code, 'OVERLAPPING_SPEECH')
        raw['audio']['tts']['start'] = 1.5
        self.prepare(raw=raw)
        raw['audio']['tts']['start'] = 0; raw['creator'] = {'useClipAudio': False}
        self.prepare(raw=raw)

    def test_private_output_symlink_rejected(self):
        c, _, ctx = validate(config())
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as external:
            (Path(d)/'audio-work').symlink_to(external, target_is_directory=True)
            with self.assertRaises(ConfigError): prepare_tts(c, ctx, Path(d), FakeTTSProvider())
            self.assertEqual(list(Path(external).iterdir()), [])

    def test_generated_file_cannot_be_replaced_by_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            outside = Path(d)/'outside.wav'; outside.write_bytes(b'unchanged')
            class Escape:
                def synthesize(self, text, voice, speed, path):
                    path.unlink(); path.symlink_to(outside); return {}
            with self.assertRaises(ConfigError): self.prepare(Escape())
            self.assertEqual(outside.read_bytes(), b'unchanged')

    def test_network_guard_blocks_native_socket_creation(self):
        env = {'PATH': '/usr/bin:/bin', 'PYTHONPATH': str(ROOT/'scripts')}
        for module in ['tts_piper_runner', 'tts_chatterbox_runner']:
            with self.subTest(module=module):
                code = f'from {module} import deny_network; deny_network(); import socket; socket.socket()'
                result = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Operation not permitted', result.stderr)
                self.assertNotIn('network guard unavailable', result.stderr)

    def test_chatterbox_chunking_preserves_narration_without_truncation(self):
        text = ('Primera frase corta. ' * 10) + ('palabra ' * 55) + ('x' * 350)
        chunks = text_chunks(text)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(0 < len(chunk) <= 300 for chunk in chunks))
        source_chars = ''.join(text.split())
        chunk_chars = ''.join(''.join(chunks).split())
        self.assertEqual(chunk_chars, source_chars)

    def test_chatterbox_every_chunk_uses_same_reference_voice(self):
        reference = Path('/private/runtime/benchmarks/es_mx_f1.wav')
        kwargs = generation_kwargs(reference)
        self.assertEqual(kwargs['audio_prompt_path'], str(reference))
        self.assertEqual(kwargs['language_id'], 'es')
        self.assertEqual(kwargs['exaggeration'], 0.5)
        self.assertEqual(kwargs['temperature'], 0.8)
        self.assertEqual(kwargs['cfg_weight'], 0.5)

    def test_local_process_has_no_shell_no_text_argv_and_clean_env(self):
        with tempfile.TemporaryDirectory() as runtime:
            runtime = Path(runtime)
            for path in ['.venv/bin/python', 'space/chatterbox/src/chatterbox/tts.py', 'benchmarks/es_mx_f1.wav']:
                p = runtime/path; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b'fixture')
            def run(args, **kwargs):
                self.assertNotIn('shell', kwargs)
                self.assertNotIn('Conoce nuestro', str(args))
                self.assertNotIn('HOME', kwargs['env'])
                self.assertEqual(kwargs['env']['HF_HUB_OFFLINE'], '1')
                self.assertEqual(kwargs['env']['TRANSFORMERS_OFFLINE'], '1')
                self.assertEqual(kwargs['env']['HF_HUB_DISABLE_IMPLICIT_TOKEN'], '1')
                self.assertNotIn('HF_TOKEN', kwargs['env'])
                self.assertTrue(kwargs['env']['HF_TOKEN_PATH'].endswith('/no-hf-token'))
                self.assertTrue(str(args[2]).endswith('tts_chatterbox_runner.py'))
                tts = json.loads(kwargs['input'])
                FakeTTSProvider().synthesize(tts['text'], tts['voice'], tts['speed'], Path(args[3]))
                return subprocess.CompletedProcess(args, 0, '{"networkDenied":true,"peakRssKiB":100}', '')
            real_run = subprocess.run
            def route(args, **kwargs):
                return run(args, **kwargs) if str(args[0]) == str(runtime/'.venv/bin/python') else real_run(args, **kwargs)
            with patch.object(tts_provider, 'RUNTIME', runtime), patch.object(tts_provider, 'HF_HOME', runtime/'hf-home'), patch.object(tts_provider, 'HF_HUB_CACHE', runtime/'hub'), patch.object(tts_provider.subprocess, 'run', side_effect=route):
                _, _, _, meta = self.prepare(LocalTTSProvider())
                self.assertEqual(meta['voiceProvider'], 'local-tts')
                self.assertEqual(meta['voiceModel'], 'chatterbox-es-mx-latam-v3')


if __name__ == '__main__': unittest.main()
