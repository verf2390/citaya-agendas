"""Segment-specific bookend identities and real FFmpeg overwrite regression."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'scripts'), str(ROOT / 'backend')]
import business_modern
from business_modern import bookend_frame_name
from compose import compile_composition
from production import digest, process, read_json, validate
from test_business_modern import Elements


class BookendIdentityTests(unittest.TestCase):
    source = hashlib.sha256(b'video A').hexdigest()

    def test_original_colliding_segments_have_distinct_paths(self):
        self.assertNotEqual(bookend_frame_name(self.source, 5, 3),
                            bookend_frame_name(self.source, 2, 3, last=True))

    def test_same_extraction_timestamp_has_separate_roles(self):
        # A one-second closing segment starts decoding at the same offset as
        # its opener, but still has a separate extraction purpose.
        self.assertNotEqual(bookend_frame_name(self.source, 2, 1),
                            bookend_frame_name(self.source, 2, 1, last=True))

    def test_different_sources_and_ranges_have_separate_paths(self):
        other = hashlib.sha256(b'video B').hexdigest()
        opening = bookend_frame_name(self.source, 2, 3)
        self.assertNotEqual(opening, bookend_frame_name(other, 2, 3))
        # The opening timestamp is identical but the selected range differs.
        self.assertNotEqual(opening, bookend_frame_name(self.source, 2, 4))
        # Equal end/last-second decoding windows, different selected ranges.
        self.assertNotEqual(bookend_frame_name(self.source, 2, 3, last=True),
                            bookend_frame_name(self.source, 3, 2, last=True))

    def test_identical_requests_are_deterministic(self):
        self.assertEqual(bookend_frame_name(self.source, 2, 3),
                         bookend_frame_name(self.source, 2, 3))

    def test_decimal_offsets_are_losslessly_normalized(self):
        self.assertEqual(bookend_frame_name(self.source, 2, 3),
                         bookend_frame_name(self.source, 2.0, 3.0))
        offsets = (2, 2.000001, 2.1, 2.0000001)
        self.assertEqual(len({bookend_frame_name(self.source, x, 3) for x in offsets}),
                         len(offsets))

    def test_filename_contains_no_source_path_or_user_tokens(self):
        for source in (self.source, '../../outside.png', '/private/video.mp4'):
            for last in (False, True):
                name = bookend_frame_name(source, 2, 3, last=last)
                self.assertRegex(name, r'^frame-hold-(opening|closing)-[0-9a-f]{64}\.png$')
                self.assertEqual(Path(name).name, name)
                self.assertLess(len(name), 100)


class BookendExtractionTests(unittest.TestCase):
    def test_opening_frame_survives_closing_extraction_and_html_uses_each(self):
        with tempfile.TemporaryDirectory(prefix='test-hold-', dir=ROOT / 'inputs') as source_dir, \
                tempfile.TemporaryDirectory() as output_dir:
            source = Path(source_dir) / 'colors.mp4'
            # Red before 5s, blue from 5s onwards: opener [5,8] must be blue,
            # closer [2,5] must be red. They used to share hold-5.000000.png.
            process(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
                     "color=c=red:s=64x64:r=24:d=9,drawbox=color=blue:t=fill:enable='gte(t,5)'",
                     '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                     '-threads', '1', source], timeout=60)
            source_hash = digest(source)
            raw = read_json(ROOT / 'configs/examples/local-business-modern.json')
            video_scene = {**raw['scenes'][1], 'video': source.relative_to(ROOT).as_posix()}
            raw['scenes'] = [{**video_scene, 'videoOffset': 5, 'duration': 3},
                             {**video_scene, 'videoOffset': 2, 'duration': 3}]
            raw['timing']['demo'] = 6
            c, _, ctx = validate(raw)
            extractions = []

            def record_extraction(args, **kwargs):
                result = process(args, **kwargs)
                target = Path(args[-1])
                extractions.append((args, target, target.read_bytes()))
                return result

            with patch.object(business_modern, 'process', side_effect=record_extraction):
                comp, _ = compile_composition(c, ctx, Path(output_dir), 'preview')
            self.assertEqual(len(extractions), 2)
            opening, closing = (item[1] for item in extractions)
            self.assertNotEqual(opening, closing)
            self.assertEqual(opening.name, bookend_frame_name(source_hash, 5, 3))
            self.assertEqual(closing.name, bookend_frame_name(source_hash, 2, 3, last=True))
            for _, target, captured in extractions:
                self.assertEqual(target.parent, comp / 'assets/inputs')
                self.assertEqual(target.read_bytes(), captured)
            self.assertNotEqual(opening.read_bytes(), closing.read_bytes())
            self.assertEqual(digest(source), source_hash)

            # Confirm actual pixels, not merely different names/PNG metadata.
            for frame, channel in ((opening, 2), (closing, 0)):
                pixels = process(['ffmpeg', '-v', 'error', '-i', frame, '-frames:v', '1',
                                  '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-threads', '1',
                                  'pipe:1'], capture_output=True, timeout=60).stdout
                self.assertEqual(len(pixels), 64 * 64 * 3)
                self.assertGreater(pixels[channel], 200)
                self.assertLess(pixels[2 - channel], 40)

            nodes = Elements((comp / 'index.html').read_text()).nodes
            images = [a['src'] for tag, a in nodes if tag == 'img' and
                      a.get('class') == 'modern-media']
            self.assertEqual(images, [opening.relative_to(comp).as_posix(),
                                      closing.relative_to(comp).as_posix()])
            videos = [a for tag, a in nodes if tag == 'video']
            self.assertEqual([v['data-media-start'] for v in videos], ['5.000000', '2.000000'])
            self.assertEqual([v['data-duration'] for v in videos], ['3.000000', '3.000000'])
            self.assertEqual(len(list((comp / 'assets/inputs').glob('*-hold-*.png'))), 2)


if __name__ == '__main__':
    unittest.main()
