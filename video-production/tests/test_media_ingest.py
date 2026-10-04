"""CIT-123: safe folder ingestion and deterministic media mapping."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / "scripts"))
import media_ingest as ingest


class MediaIngestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root = base / "video-production"
        self.inputs = self.root / "inputs"
        self.project = self.inputs / "projects" / "demo"
        self.project.mkdir(parents=True)
        self.patches = [
            patch.object(ingest, "ROOT", self.root),
            patch.object(ingest, "REPO_ROOT", base),
            patch.object(ingest, "INPUT_ROOT", self.inputs.resolve()),
            patch.object(ingest, "inspect_media", side_effect=self.fake_inspect),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def fake_inspect(self, path):
        ext = Path(path).suffix.lower()
        kind = "image" if ext in (".png", ".jpg", ".jpeg", ".webp") else "video" if ext in (".mp4", ".mov", ".webm") else "audio"
        return {
            "type": kind, "bytes": Path(path).stat().st_size,
            "durationMs": 4000 if kind != "image" else 0,
            "width": 1080 if kind != "audio" else None,
            "height": 1920 if kind != "audio" else None,
            "codec": "test", "sha256": ingest.digest(path),
        }

    def put(self, name, content=b"fixture"):
        path = self.project / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, str):
            path.write_text(content, encoding="utf-8")
        else:
            path.write_bytes(content)
        return path

    def test_autodetects_supported_roles(self):
        for name in (
            "logo.png", "creator-intro.mp4", "creator-outro.webm",
            "voiceover.wav", "background-music.mp3", "sfx-click.wav",
            "photo.jpg", "clip.mp4", "screenshots/home.png",
        ):
            self.put(name)
        self.put("captions.srt", "1\n00:00:00,000 --> 00:00:01,000\nHola\n")
        manifest = ingest.scan_media(self.project)
        roles = {item["role"] for item in manifest["files"]}
        self.assertTrue({"logo", "creatorIntro", "creatorOutro", "creatorVoiceover", "backgroundMusic", "soundEffects", "images", "videos", "screenshots", "srt"} <= roles)
        patch_data = manifest["configPatch"]
        self.assertIn("logo", patch_data["brand"])
        self.assertEqual(patch_data["media"]["creatorIntro"].split("/")[-1], "creator-intro.mp4")
        self.assertTrue(patch_data["subtitles"]["enabled"])

    def test_rejects_directory_outside_inputs(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        with self.assertRaises(ingest.MediaIngestError) as ctx:
            ingest.scan_media(outside)
        self.assertEqual(ctx.exception.code, "UNSAFE_MEDIA_DIR")

    def test_rejects_root_symlink_and_accepts_spanish_accents(self):
        target = self.inputs / "projects" / "target"
        target.mkdir(parents=True)
        link = self.inputs / "projects" / "linked"
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest("symlinks unavailable")
        with self.assertRaises(ingest.MediaIngestError) as ctx:
            ingest.scan_media(link)
        self.assertEqual(ctx.exception.code, "UNSAFE_MEDIA_DIR")

        self.put("narración.wav")
        manifest = ingest.scan_media(self.project)
        roles = {item["role"] for item in manifest["files"]}
        self.assertIn("creatorVoiceover", roles)

    def test_rejects_unsupported_hidden_and_ambiguous_audio(self):
        for name, code in (("logo.svg", "UNSUPPORTED_MEDIA"), (".secret.png", "UNSUPPORTED_MEDIA"), ("audio.wav", "AMBIGUOUS_AUDIO")):
            with self.subTest(name=name):
                for existing in self.project.iterdir():
                    if existing.is_file():
                        existing.unlink()
                self.put(name)
                with self.assertRaises(ingest.MediaIngestError) as ctx:
                    ingest.scan_media(self.project)
                self.assertEqual(ctx.exception.code, code)

    def test_rejects_duplicate_singletons_and_two_subtitle_formats(self):
        self.put("intro-one.mp4")
        self.put("intro-two.mp4")
        with self.assertRaises(ingest.MediaIngestError) as ctx:
            ingest.scan_media(self.project)
        self.assertEqual(ctx.exception.code, "AMBIGUOUS_MEDIA_ROLE")
        for path in self.project.iterdir():
            path.unlink()
        self.put("captions.srt", "1\n00:00:00,000 --> 00:00:01,000\nHola\n")
        self.put("captions.vtt", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHola\n")
        with self.assertRaises(ingest.MediaIngestError) as ctx:
            ingest.scan_media(self.project)
        self.assertEqual(ctx.exception.code, "AMBIGUOUS_SUBTITLES")

    def test_rejects_symlink_and_file_count_limit(self):
        target = self.put("photo.jpg")
        link = self.project / "other.jpg"
        try:
            link.symlink_to(target)
        except OSError:
            self.skipTest("symlinks unavailable")
        with self.assertRaises(ingest.MediaIngestError) as ctx:
            ingest.scan_media(self.project)
        self.assertEqual(ctx.exception.code, "UNSAFE_MEDIA_PATH")
        link.unlink()
        target.unlink()
        for i in range(ingest.MAX_FILES + 1):
            self.put("photo-{}.jpg".format(i))
        with self.assertRaises(ingest.MediaIngestError) as ctx:
            ingest.scan_media(self.project)
        self.assertEqual(ctx.exception.code, "TOO_MANY_MEDIA_FILES")

    def test_apply_requires_explicit_human_approval(self):
        with self.assertRaises(ingest.MediaIngestError) as ctx:
            ingest.apply_manifest({"scenes": []}, {"configPatch": {}}, approved=False)
        self.assertEqual(ctx.exception.code, "MEDIA_APPROVAL_REQUIRED")

    def test_apply_maps_visuals_creator_audio_and_subtitles(self):
        config = {
            "timing": {"intro": 3, "demo": 14, "outro": 3},
            "scenes": [
                {"media": None, "video": None},
                {"media": None, "video": None},
                {"media": None, "video": None},
            ],
            "mediaApproved": False,
        }
        manifest = {"configPatch": {
            "brand": {"logo": "inputs/projects/demo/logo.png"},
            "media": {
                "images": ["inputs/projects/demo/photo.jpg"],
                "screenshots": ["inputs/projects/demo/screenshot.png"],
                "videos": ["inputs/projects/demo/clip.mp4"],
                "creatorIntro": "inputs/projects/demo/creator-intro.mp4",
                "creatorVoiceover": "inputs/projects/demo/voiceover.wav",
            },
            "subtitles": {"enabled": True, "srt": "inputs/projects/demo/captions.srt"},
        }}
        def fake_validate(value, mode):
            return value, {"valid": True, "mode": mode}, {}
        with patch.object(ingest, "validate", side_effect=fake_validate):
            result, report = ingest.apply_manifest(config, manifest, approved=True)
        self.assertTrue(result["mediaApproved"])
        self.assertEqual(result["scenes"][0]["media"].split("/")[-1], "photo.jpg")
        self.assertEqual(result["scenes"][1]["media"].split("/")[-1], "screenshot.png")
        self.assertEqual(result["scenes"][2]["video"].split("/")[-1], "clip.mp4")
        self.assertEqual(result["creator"]["voiceoverStart"], 3)
        self.assertTrue(result["audio"]["duckMusicDuringVoice"])
        self.assertTrue(result["subtitles"]["enabled"])
        self.assertEqual(report["mode"], "preview")

    def test_normalized_zero_voiceover_start_is_replaced_after_intro(self):
        config = {
            "timing": {"intro": 2.8, "demo": 14.4, "outro": 2.8},
            "scenes": [],
            "creator": {"voiceoverStart": 0, "introOffset": 0, "outroOffset": 0, "useClipAudio": True},
            "mediaApproved": False,
        }
        manifest = {"configPatch": {"media": {
            "creatorIntro": "inputs/projects/demo/creator-intro.mp4",
            "creatorVoiceover": "inputs/projects/demo/voiceover.ogg",
        }}}
        with patch.object(ingest, "validate", side_effect=lambda value, mode: (value, {"valid": True, "mode": mode}, {})):
            result, _ = ingest.apply_manifest(config, manifest, approved=True)
        self.assertEqual(result["creator"]["voiceoverStart"], 2.8)

    def test_creator_led_voiceover_refits_demo_timeline(self):
        config = {
            "template": "creator-led-v1",
            "timing": {"intro": 2.8, "demo": 14.4, "outro": 2.8},
            "scenes": [
                {"duration": 4.8},
                {"duration": 4.8},
                {"duration": 4.8},
            ],
            "mediaApproved": False,
        }
        manifest = {
            "files": [
                {"role": "creatorIntro", "inspection": {"durationMs": 9130}},
                {"role": "creatorVoiceover", "inspection": {"durationMs": 9090}},
            ],
            "configPatch": {"media": {
                "creatorIntro": "inputs/projects/demo/creator-intro.mp4",
                "creatorVoiceover": "inputs/projects/demo/voiceover.ogg",
            }},
        }
        with patch.object(ingest, "validate", side_effect=lambda value, mode: (value, {"valid": True}, {})):
            result, _ = ingest.apply_manifest(config, manifest, approved=True)
        self.assertEqual(result["timing"]["demo"], 9.69)
        self.assertAlmostEqual(sum(scene["duration"] for scene in result["scenes"]), 9.69, places=6)
        self.assertEqual(result["creator"]["voiceoverStart"], 2.8)
        self.assertAlmostEqual(sum(result["timing"].values()), 15.29, places=6)

    def test_creator_intro_promotes_default_template_to_creator_led(self):
        config = {
            "template": "citaya-saas-vertical-v1",
            "timing": {"intro": 3, "demo": 14, "outro": 3},
            "scenes": [],
            "mediaApproved": False,
        }
        manifest = {"configPatch": {"media": {
            "creatorIntro": "inputs/projects/demo/creator-intro.mp4",
        }}}
        with patch.object(ingest, "validate", side_effect=lambda value, mode: (value, {"valid": True}, {})):
            result, _ = ingest.apply_manifest(config, manifest, approved=True)
        self.assertEqual(result["template"], "creator-led-v1")

    def test_apply_rejects_conflicting_existing_mapping(self):
        config = {"brand": {"logo": "inputs/already.png"}, "scenes": []}
        manifest = {"configPatch": {"brand": {"logo": "inputs/new.png"}}}
        with self.assertRaises(ingest.MediaIngestError) as ctx:
            ingest.apply_manifest(config, manifest, approved=True)
        self.assertEqual(ctx.exception.code, "MEDIA_CONFIG_CONFLICT")


if __name__ == "__main__":
    unittest.main()
