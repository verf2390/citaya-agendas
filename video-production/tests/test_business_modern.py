"""Renderer contracts and byte-for-byte legacy output regressions (PR #110)."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'scripts'), str(ROOT / 'backend')]
from compose import compile_composition
from business_modern import bookend_frame_name
from production import ConfigError, MODES, digest, read_json, validate


class Elements(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.nodes = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag, dict(attrs)))


class ModernTests(unittest.TestCase):
    def config(self):
        return read_json(ROOT / 'configs/examples/local-business-modern.json')

    def compile(self, raw=None, mode='preview'):
        c, _, ctx = validate(raw or self.config(), mode)
        with tempfile.TemporaryDirectory() as d:
            comp, proof = compile_composition(c, ctx, Path(d), mode)
            result = (comp / 'index.html').read_text()
            self.assertTrue((comp / 'assets/branding/geist.woff2').is_file())
            if ctx['template']['renderer'] == 'business-modern':
                self.assertFalse((comp / 'assets/ui').exists())
        return result, Elements(result).nodes, proof

    def test_legacy_outputs_unchanged(self):
        fixtures = read_json(ROOT / 'tests/legacy-composition-sha256.json')
        for name, item in fixtures.items():
            with self.subTest(renderer=name):
                source, _, _ = self.compile(read_json(ROOT / item['config']))
                self.assertEqual(hashlib.sha256(source.encode()).hexdigest(), item['sha256'])

    def test_registered_and_external_only(self):
        template = read_json(ROOT / 'templates/local-business-promo-v2/template.json')
        self.assertEqual(template['renderer'], 'business-modern')
        self.assertEqual(template['version'], 2)
        self.assertIn(template, read_json(ROOT / 'catalog/templates.json')['templates'])
        products = read_json(ROOT / 'catalog/products.json')['products']
        for product in products:
            self.assertEqual('local-business-promo-v2' in product['allowedTemplates'], product['id'] == 'custom-client-video')
        self.assertEqual(next(p for p in products if p['id'] == 'custom-client-video')['defaultTemplate'], 'local-business-promo-v1')

    def test_fullscreen_image_video_overlay_and_brand(self):
        source, nodes, _ = self.compile()
        self.assertIn('object-fit:cover', source)
        self.assertIn('inset:0;width:100%;height:100%', source)
        self.assertIn('border:0;border-radius:0', source)
        for tag, node in nodes:
            self.assertNotIn('screen', node.get('class', '').split())
            self.assertNotIn('benefit-card', node.get('class', '').split())
        self.assertTrue(any(t == 'img' and a.get('class') == 'modern-media' for t, a in nodes))
        video = next(a for t, a in nodes if t == 'video')
        self.assertEqual(video['data-start'], '3.500000')
        self.assertEqual(video['data-duration'], '3.000000')
        self.assertEqual(video['data-media-start'], '0.000000')
        self.assertIn('modern-headline', source)
        self.assertIn('modern-brand', source)
        self.assertNotIn('brand-chrome', source)
        self.assertNotIn('Demostración ·', source)
        self.assertNotIn('assets/ui/', source)

    def test_image_bookends_present_from_zero_and_under_cta(self):
        _, nodes, _ = self.compile()
        hook = next(a for t, a in nodes if a.get('id') == 'hook-background')
        self.assertEqual(hook['data-start'], '0.000000')
        images = [a['src'] for t, a in nodes if t == 'img' and a.get('class') == 'modern-media']
        self.assertEqual(images[0], images[1])
        self.assertEqual(images[-1], images[-2])
        self.assertTrue(any(a.get('id') == 'outro-background' for _, a in nodes))

    def test_brand_logo_is_reserved_for_prominent_outro(self):
        raw = self.config()
        source, nodes, _ = self.compile(raw)
        end_logo = next(a for _, a in nodes if a.get('id') == 'end-logo')
        duration = sum(raw['timing'].values())
        self.assertEqual(float(end_logo['data-start']), duration - raw['timing']['outro'])
        self.assertEqual(float(end_logo['data-duration']), raw['timing']['outro'])
        self.assertIn('class="modern-end-logo"', source)
        self.assertIn('max-width:420px', source)

    def test_video_bookends_hold_source_frames_without_retiming(self):
        raw = self.config()
        raw['scenes'] = [raw['scenes'][1]]
        raw['timing']['demo'] = 3
        c, _, ctx = validate(raw)
        # Fixture source is 24 fps; final export is 30 fps. Both must have a hold.
        for mode in ('preview', 'final'):
            with tempfile.TemporaryDirectory() as d:
                comp, _ = compile_composition(c, ctx, Path(d), mode)
                nodes = Elements((comp / 'index.html').read_text()).nodes
                videos = [a for t, a in nodes if t == 'video']
                self.assertEqual(len(videos), 1)
                self.assertEqual(videos[0]['data-duration'], '3.000000')
                holds = list((comp / 'assets/inputs').glob('*-hold-*.png'))
                self.assertEqual(len(holds), 2)
                self.assertTrue(all(p.stat().st_size > 100 for p in holds))

    def test_scene_offsets_reused_video_and_bookends(self):
        raw = self.config()
        video_scene = raw['scenes'][1]
        raw['scenes'] = [{**video_scene, 'duration': 1.5, 'videoOffset': 0},
                         {**video_scene, 'duration': 1.5, 'videoOffset': 1.5}]
        raw['timing']['demo'] = 3
        for template in ('local-business-promo-v2', 'creator-led-v1'):
            raw['template'] = template
            source, nodes, _ = self.compile(raw)
            videos = [a for tag, a in nodes if tag == 'video']
            self.assertEqual([float(v['data-media-start']) for v in videos], [0, 1.5])
            self.assertEqual([float(v['data-duration']) for v in videos], [1.5, 1.5])
            self.assertEqual(videos[0]['src'], videos[1]['src'])
        raw['template'] = 'local-business-promo-v2'
        c, _, ctx = validate(raw)
        with tempfile.TemporaryDirectory() as d:
            comp, _ = compile_composition(c, ctx, Path(d), 'preview')
            name = bookend_frame_name(digest(ROOT / video_scene['video']), 1.5, 1.5, last=True)
            self.assertTrue((comp / 'assets/inputs' / name).is_file())

    def test_invalid_offsets_and_segments_fail_production_validation(self):
        for offset, duration in [(-1, 3), (float('nan'), 3), (True, 3), (1, 3), (4, 1), (0, 0)]:
            with self.subTest(offset=offset, duration=duration):
                raw = self.config()
                raw['scenes'][1].update(videoOffset=offset, duration=duration)
                with self.assertRaises(ConfigError):
                    validate(raw)
        raw = self.config()
        raw['scenes'][0]['videoOffset'] = 0
        with self.assertRaises(ConfigError):
            validate(raw)

    def test_no_media_safe_fallback_and_no_invented_contact(self):
        raw = self.config()
        raw.pop('media')
        raw['brand'] = {'businessName': 'Estudio Demo'}
        for scene in raw['scenes']:
            scene.pop('media', None)
            scene.pop('video', None)
        source, nodes, _ = self.compile(raw)
        self.assertFalse(any(tag in ('img', 'video') for tag, _ in nodes))
        self.assertIn('modern-fallback', source)
        self.assertIn('class="modern-brand-name"', source)
        self.assertNotIn('class="modern-contact"', source)
        self.assertIn('Reserva tu hora', source)

    def test_offer_price_and_feature_are_small_overlays(self):
        raw = self.config()
        raw['content'].update({
            'offer': 'Corte + barba',
            'price': '$18.000',
            'featureLabels': ['Tu estilo', 'Cada detalle cuenta'],
        })
        source, nodes, _ = self.compile(raw)
        self.assertIn('Corte + barba · $18.000', source)
        self.assertEqual(sum(a.get('class') == 'modern-offer' for _, a in nodes), 3)
        self.assertEqual(sum(a.get('class') == 'modern-feature' for _, a in nodes), 3)
        self.assertNotIn('benefit-card', source)
        self.assertIn('font-size:29px', source)

    def test_presets_and_motion_are_deterministic(self):
        sources = []
        for preset in ('minimal', 'dynamic', 'premium'):
            raw = self.config()
            raw['stylePreset'] = preset
            source = self.compile(raw)[0]
            self.assertEqual(source, self.compile(raw)[0])
            self.assertNotIn('random', source.lower())
            self.assertNotIn('Date.now', source)
            self.assertNotIn('repeat:', source)
            self.assertIn("ease:'none'", source)
            self.assertIn('xPercent:', source)
            sources.append(source)
        self.assertEqual(len(set(sources)), 3)

    def test_remote_media_and_arbitrary_code_rejected(self):
        for key, value in [('media', 'https://example.invalid/a.png'), ('video', '//example.invalid/a.mp4'), ('animation', 'alert(1)'), ('style', 'color:red')]:
            raw = self.config()
            raw['scenes'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ConfigError):
                validate(raw)
        raw = self.config()
        raw['scenes'][0]['headline'] = '<img src=x onerror=alert(1)>'
        with self.assertRaises(ConfigError):
            validate(raw)

    def test_escaping_and_local_csp(self):
        raw = self.config()
        raw['scenes'][0]['headline'] = 'Corte & cuidado "personal"'
        source, nodes, _ = self.compile(raw)
        self.assertIn('Corte &amp; cuidado &quot;personal&quot;', source)
        self.assertIn("connect-src 'self'", source)
        self.assertTrue(all(not a['src'].startswith(('http:', 'https:', '//')) for _, a in nodes if 'src' in a))
        # Even a caller bypassing validation cannot turn text into markup.
        c, _, ctx = validate(raw)
        c['hook'] = '<script>alert(1)</script>'
        with tempfile.TemporaryDirectory() as d:
            comp, _ = compile_composition(c, ctx, Path(d), 'preview')
            source = (comp / 'index.html').read_text()
            self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', source)
            self.assertNotIn('<script>alert(1)</script>', source)

    def test_creator_offsets_captions_and_hook_compatibility(self):
        raw = self.config()
        raw['media'].update(creatorIntro='inputs/test-fixtures/intro.mp4', creatorOutro='inputs/test-fixtures/intro.mp4')
        raw['creator'] = {'introOffset': .5, 'outroOffset': 1, 'useClipAudio': False}
        raw['subtitles'] = {'enabled': True, 'vtt': 'inputs/test-fixtures/captions.vtt'}
        source, nodes, _ = self.compile(raw)
        for id, offset in [('creator-intro-video', '.5'), ('outro-video', '1')]:
            video = next(a for _, a in nodes if a.get('id') == id)
            self.assertEqual(float(video['data-media-start']), float(offset))
        self.assertNotIn('id="hook"', source)
        self.assertIn('with-captions', source)
        self.assertIn('class="modern-caption"', source)
        self.assertIn('Tu estilo empieza aquí', source)

    def test_preview_and_final_geometry_preserved(self):
        for mode, width, height, fps in [('preview', 720, 1280, 24), ('final', 1080, 1920, 30)]:
            _, nodes, proof = self.compile(mode=mode)
            root = next(a for _, a in nodes if a.get('id') == 'root')
            self.assertEqual((int(root['data-width']), int(root['data-height']), int(root['data-fps'])), (width, height, fps))
            self.assertEqual(float(root['data-duration']), 10)
            self.assertTrue(all(0 < at < 10 for at in proof))


if __name__ == '__main__':
    unittest.main()
