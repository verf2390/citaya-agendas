"""Regression coverage for non-destructive master-video + TTS remix."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid
import wave
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'scripts'), str(ROOT / 'backend'), str(ROOT / 'tests')]

import audio_mix
import tenant_brief
from audio_mix import mix_audio
from compose import compile_composition
from production import probe, schema_validate, tenant_schema_validate, validate
from fake_tts import FakeTTSProvider
from test_vision_provider import observation
from tts_provider import prepare_tts


class MasterVideoRemixTests(unittest.TestCase):
    def setUp(self):
        self.asset_id = str(uuid.uuid4())
        self.master_ref = 'asset:' + self.asset_id
        self.brief = (
            "CORRECCIÓN DEL VIDEO\n"
            "El primer video debe tratarse como VIDEO BASE / MASTER.\n"
            "No quiero que reconstruyas el Reel desde cero.\n"
            "Conservar su música original y reducir el volumen cuando entre la locución.\n"
            "LOCUCIÓN:\n"
            "Un buen corte cambia todo. En Eder Barber Studio, cada detalle cuenta. Reserva tu hora online."
        )
        self.config = {
            'schemaVersion': 1,
            'product': 'custom-client-video',
            'template': 'local-business-promo-v2',
            'stylePreset': 'dynamic',
            'niche': 'barber',
            'videoType': 'promotion',
            'brand': {'businessName': 'HDR BARBER STUDIO'},
            'capabilities': ['provided_business_content'],
            'content': {
                'hook': 'HDR BARBER STUDIO',
                'secondaryHook': 'Barbería',
                'benefit': 'HDR BARBER STUDIO',
                'cta': 'Conoce más',
                'finalTagline': 'HDR BARBER STUDIO',
            },
            'media': {'creatorIntro': self.master_ref, 'images': [], 'videos': []},
            'creator': {'useClipAudio': True, 'voiceoverStart': 25.134},
            'mediaPolicy': {
                'useOnlyProvidedAssets': True,
                'allowStockMedia': False,
                'allowGeneratedMedia': False,
                'mediaFirst': True,
            },
            'mediaApproved': True,
            'timing': {'intro': 25.134, 'demo': 3, 'outro': 1.6},
            'project': {
                'productContext': 'external',
                'creativeBrief': self.brief,
                'targetDurationSeconds': 20,
                'category': 'Barbería',
            },
        }
        self.assets = [{
            'id': self.asset_id,
            'assetType': 'video',
            'durationMs': 25134,
            'width': 1080,
            'height': 1920,
        }]
        visual = observation()
        visual.pop('evidence')
        visual['status'] = 'complete'
        self.inventory = {self.asset_id: visual}

    def test_explicit_master_request_routes_without_recut_or_model_call(self):
        with patch.object(tenant_brief, 'gateway_call') as gateway:
            directed, report, usage = tenant_brief.direct_tenant_config(
                config=self.config,
                assets=self.assets,
                visual_inventory=self.inventory,
            )
        gateway.assert_not_called()
        self.assertEqual(directed['template'], 'master-video-remix-v1')
        self.assertAlmostEqual(sum(directed['timing'].values()), 25.134, places=3)
        self.assertEqual(len(directed['scenes']), 1)
        self.assertEqual(directed['scenes'][0]['video'], self.master_ref)
        self.assertEqual(directed['scenes'][0]['videoOffset'], 0)
        self.assertFalse(directed['creator']['useClipAudio'])
        self.assertEqual(directed['audio']['tts']['start'], 0)
        self.assertTrue(directed['audio']['music'])
        self.assertTrue(directed['audio']['duckMusicDuringVoice'])
        self.assertTrue(directed['audio']['masterClipBed'])
        self.assertFalse(directed['audio']['sfx'])
        self.assertTrue(report['masterVideoRemix'])
        self.assertEqual(report['plannedDurationSeconds'], 25.134)
        self.assertEqual(usage['totalTokens'], 0)
        schema_validate(directed)
        tenant_schema_validate(directed)

    def test_normal_promotion_does_not_enable_master_remix(self):
        self.assertFalse(tenant_brief._master_video_remix_requested(
            'Crea un Reel con mis videos. LOCUCIÓN: Reserva tu hora.'
        ))
        self.assertTrue(tenant_brief._master_video_remix_requested(self.brief))

    def test_master_clip_is_selected_as_non_looping_music_bed(self):
        config = {
            'audio': {'masterClipBed': True},
            'creator': {'introVideo': 'inputs/master.mp4'},
            'media': {},
        }
        source, loop, kind = audio_mix._music_bed_source(config)
        self.assertEqual(source, ROOT / 'inputs/master.mp4')
        self.assertFalse(loop)
        self.assertEqual(kind, 'master-clip')

    def test_real_validation_compile_and_mix_preserve_master_duration(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'inputs', prefix='master-remix-test-') as d:
            master = Path(d) / 'master.mp4'
            subprocess.run([
                'ffmpeg', '-y', '-v', 'error',
                '-f', 'lavfi', '-i', 'color=c=0x222222:s=180x320:r=24',
                '-f', 'lavfi', '-i', 'sine=frequency=173:sample_rate=48000',
                '-t', '10', '-c:v', 'libx264', '-preset', 'ultrafast',
                '-c:a', 'aac', '-pix_fmt', 'yuv420p', str(master),
            ], check=True)
            rel = str(master.relative_to(ROOT))
            raw = {
                'schemaVersion': 1,
                'product': 'custom-client-video',
                'template': 'master-video-remix-v1',
                'stylePreset': 'dynamic',
                'niche': 'barber',
                'videoType': 'promotion',
                'brand': {'businessName': 'HDR BARBER STUDIO'},
                'capabilities': ['provided_business_content'],
                'content': {
                    'hook': 'HDR BARBER STUDIO',
                    'secondaryHook': 'Barbería',
                    'benefit': 'HDR BARBER STUDIO',
                    'cta': 'Reserva tu hora online',
                    'finalTagline': 'HDR BARBER STUDIO',
                },
                'media': {'creatorIntro': rel},
                'creator': {'useClipAudio': False, 'voiceoverStart': 0},
                'mediaPolicy': {
                    'useOnlyProvidedAssets': True,
                    'allowStockMedia': False,
                    'allowGeneratedMedia': False,
                    'mediaFirst': True,
                },
                'mediaApproved': True,
                'audio': {
                    'music': True,
                    'sfx': False,
                    'duckMusicDuringVoice': True,
                    'masterClipBed': True,
                    'tts': {'enabled': True, 'text': 'Un buen corte cambia todo.', 'voice': 'es-male-1', 'start': 0, 'speed': 1},
                },
                'timing': {'intro': 1.5, 'demo': 7.0, 'outro': 1.5},
                'scenes': [{
                    'capability': 'provided_business_content',
                    'mode': 'media',
                    'headline': 'HDR BARBER STUDIO',
                    'duration': 7.0,
                    'video': rel,
                    'videoOffset': 0,
                }],
                'project': {
                    'productContext': 'external',
                    'creativeBrief': self.brief,
                    'targetDurationSeconds': 10,
                    'category': 'Barbería',
                },
            }
            normalized, report, ctx = validate(raw, 'preview')
            self.assertEqual(ctx['speech'], [])
            with tempfile.TemporaryDirectory() as output:
                out = Path(output)
                prepare_tts(normalized, ctx, out, FakeTTSProvider(duration=3))
                self.assertEqual(len(ctx['speech']), 1)
                comp, _ = compile_composition(normalized, ctx, out, 'preview')
                html = (comp / 'index.html').read_text()
                self.assertIn('data-composition-id="master-video-remix"', html)
                self.assertIn('object-fit:contain', html)
                self.assertIn('data-duration="10.000000"', html)
                mix_audio(normalized, ctx, out, comp)
                meta = json.loads((out / 'audio-metadata.json').read_text())
                self.assertEqual(meta['musicSource'], 'master-clip')
                self.assertTrue(meta['ducking'])
                self.assertTrue(meta['spectralCarve'])
                self.assertAlmostEqual(float(probe(comp / 'assets/master.wav')['format']['duration']), 10, places=2)

    def test_catalog_and_schemas_register_master_remix(self):
        templates = json.loads((ROOT / 'catalog/templates.json').read_text())['templates']
        products = json.loads((ROOT / 'catalog/products.json').read_text())['products']
        self.assertEqual(
            next(t for t in templates if t['id'] == 'master-video-remix-v1')['renderer'],
            'master-video-remix',
        )
        self.assertIn(
            'master-video-remix-v1',
            next(p for p in products if p['id'] == 'custom-client-video')['allowedTemplates'],
        )


if __name__ == '__main__':
    unittest.main()
