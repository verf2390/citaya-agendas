"""Real FFmpeg fixtures, generated in temporary storage; no production data."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import extract_frames as extraction
from production import ConfigError


class FrameExtractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise RuntimeError("These integration tests require FFmpeg and FFprobe.")
        cls.fixtures = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.fixtures.cleanup)
        cls.root = Path(cls.fixtures.name)

        def video(name, size, duration="1.2", extra=(), codec="libx264"):
            cls.command([
                "ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi", "-i",
                f"testsrc2=size={size}:rate=10:duration={duration}",
                *extra, "-c:v", codec, "-threads", "1", str(cls.root / name),
            ])

        video("vertical.mp4", "90x160")
        video("horizontal.mov", "160x90")
        video("short.mp4", "90x160", "0.05")
        video("web.webm", "160x90", codec="libvpx-vp9")
        video("vfr.mp4", "160x90", extra=(
            "-vf", "setpts='if(lt(N,5),N,5+(N-5)*3)/(10*TB)'", "-fps_mode", "vfr",
        ))
        video("sar.mp4", "160x120", extra=("-vf", "setsar=2"))
        cls.command([
            "ffmpeg", "-v", "error", "-display_rotation", "90", "-i", str(cls.root / "horizontal.mov"),
            "-c", "copy", str(cls.root / "rotated.mov"),
        ])
        for suffix in ("png", "jpg", "jpeg", "webp"):
            cls.command([
                "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90",
                "-frames:v", "1", "-threads", "1", "-update", "1",
                str(cls.root / ("photo." + suffix)),
            ])
        cls.command([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=blue:size=1600x900",
            "-frames:v", "1", "-threads", "1", "-update", "1", str(cls.root / "large.png"),
        ])
        cls.command([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=160x90:r=10:d=2",
            "-c:v", "libx264", "-threads", "1", str(cls.root / "static.mp4"),
        ])
        # Little-endian EXIF orientation=6 (90 degrees clockwise), without Pillow.
        tiff = b"II" + struct.pack("<HIH", 42, 8, 1)
        tiff += struct.pack("<HHI", 0x112, 3, 1) + struct.pack("<H", 6) + b"\0\0"
        tiff += struct.pack("<I", 0)
        exif = b"Exif\0\0" + tiff
        jpeg = (cls.root / "photo.jpg").read_bytes()
        (cls.root / "oriented.jpg").write_bytes(
            jpeg[:2] + b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif + jpeg[2:]
        )
        # Hard cut at 0.8s, between the uniform candidates (0.6s and 0.9s).
        cls.command([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=red:s=160x90:r=10:d=0.8",
            "-f", "lavfi", "-i", "color=blue:s=160x90:r=10:d=1.6",
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]",
            "-c:v", "libx264", "-threads", "1", str(cls.root / "cut.mp4"),
        ])

    @staticmethod
    def command(args, **kwargs):
        return subprocess.run(args, check=True, capture_output=True, text=True,
                              timeout=30, **kwargs)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.output = self.base / "frames"

    def extract(self, name="vertical.mp4", maximum=8, output=None):
        return extraction.extract_frames(self.root / name, output or self.output, maximum)

    def assert_manifest(self, manifest, maximum=8, output=None):
        output = output or self.output
        frames = manifest["frames"]
        self.assertGreater(len(frames), 0)
        self.assertLessEqual(len(frames), maximum)
        times = [frame["timestampMs"] for frame in frames]
        self.assertEqual(times, sorted(set(times)))
        for index, frame in enumerate(frames, 1):
            self.assertEqual(frame["id"], f"frame-{index:04d}")
            self.assertEqual(frame["path"], f"frame-{index:04d}.jpg")
            self.assertFalse(Path(frame["path"]).is_absolute())
            self.assertNotIn("..", Path(frame["path"]).parts)
            self.assertGreaterEqual(frame["timestampMs"], 0)
            if manifest["sourceType"] == "video":
                self.assertLess(frame["timestampMs"], manifest["durationMs"])
            else:
                self.assertEqual(frame["timestampMs"], 0)
            self.assertLessEqual(max(frame["width"], frame["height"]), 1280)
            path = output / frame["path"]
            self.assertEqual(frame["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(sorted(p.name for p in output.iterdir()), sorted(f["path"] for f in frames))

    def test_vertical_video(self):
        manifest = self.extract()
        self.assertEqual(manifest["sourceType"], "video")
        self.assertEqual((manifest["frames"][0]["width"], manifest["frames"][0]["height"]), (90, 160))
        self.assert_manifest(manifest)

    def test_horizontal_video(self):
        manifest = self.extract("horizontal.mov")
        self.assertEqual((manifest["width"], manifest["height"]), (160, 90))
        self.assert_manifest(manifest)

    def test_webm(self):
        self.assert_manifest(self.extract("web.webm"))

    def test_very_short_single_frame_video(self):
        manifest = self.extract("short.mp4")
        self.assertEqual(len(manifest["frames"]), 1)
        self.assert_manifest(manifest)

    def test_variable_fps_uses_decoded_timestamps(self):
        probe = self.command([
            "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
            "-show_entries", "frame=best_effort_timestamp_time", "-of", "json",
            str(self.root / "vfr.mp4"),
        ])
        times = [round(float(f["best_effort_timestamp_time"]) * 1000)
                 for f in json.loads(probe.stdout)["frames"]]
        self.assertGreater(len(set(b - a for a, b in zip(times, times[1:]))), 1)
        manifest = self.extract("vfr.mp4")
        self.assertGreater(manifest["durationMs"], max(times))
        self.assertTrue({f["timestampMs"] for f in manifest["frames"]} <= set(times))
        self.assert_manifest(manifest)

    def test_all_image_formats_one_frame_without_upscale(self):
        for suffix in ("png", "jpg", "jpeg", "webp"):
            with self.subTest(suffix=suffix):
                output = self.base / suffix
                manifest = self.extract("photo." + suffix, output=output)
                self.assertEqual(manifest["sourceType"], "image")
                self.assertEqual(manifest["durationMs"], 0)
                self.assertEqual(len(manifest["frames"]), 1)
                self.assertEqual((manifest["frames"][0]["width"], manifest["frames"][0]["height"]), (160, 90))
                self.assert_manifest(manifest, output=output)

    def test_large_image_is_scaled_proportionally(self):
        manifest = self.extract("large.png")
        self.assertEqual((manifest["frames"][0]["width"], manifest["frames"][0]["height"]), (1280, 720))
        self.assert_manifest(manifest)

    def test_video_rotation(self):
        manifest = self.extract("rotated.mov")
        frame = manifest["frames"][0]
        self.assertEqual((frame["width"], frame["height"]), (90, 160))

    def test_image_exif_orientation(self):
        frame = self.extract("oriented.jpg")["frames"][0]
        self.assertEqual((frame["width"], frame["height"]), (90, 160))

    def test_non_square_pixels_preserve_display_aspect(self):
        frame = self.extract("sar.mp4")["frames"][0]
        self.assertEqual((frame["width"], frame["height"]), (160, 60))

    def test_max_frames_order_bounds_hashes_and_paths(self):
        for maximum in (1, 2, 3, 8):
            with self.subTest(maximum=maximum):
                output = self.base / str(maximum)
                manifest = self.extract(maximum=maximum, output=output)
                self.assert_manifest(manifest, maximum, output)

    def test_scene_candidate_can_replace_nearby_uniform_sample(self):
        manifest = self.extract("cut.mp4", maximum=4)
        self.assertIn(800, [f["timestampMs"] for f in manifest["frames"]])
        self.assert_manifest(manifest, 4)

    def test_byte_identical_evidence_is_deduplicated(self):
        manifest = self.extract("static.mp4", maximum=32)
        self.assertEqual(len(manifest["frames"]), 1)
        self.assertEqual(manifest["frames"][0]["timestampMs"], 0)
        self.assert_manifest(manifest, 32)

    def test_cli_json_is_byte_deterministic(self):
        args = [sys.executable, str(ROOT / "scripts/extract_frames.py"),
                "--input", str(self.root / "vertical.mp4"), "--max-frames", "4"]
        first = self.command(args + ["--output", str(self.output)])
        second_output = self.base / "second"
        second = self.command(args + ["--output", str(second_output)])
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(first.stderr, "")
        self.assert_manifest(json.loads(first.stdout), 4)
        self.assert_manifest(json.loads(second.stdout), 4, second_output)

    def test_missing_input(self):
        with self.assertRaises(ConfigError):
            self.extract("missing.mp4")
        self.assertFalse(self.output.exists())

    def test_corrupt_file(self):
        path = self.base / "corrupt.mp4"
        path.write_bytes(b"not a video")
        with self.assertRaises(ConfigError):
            extraction.extract_frames(path, self.output)
        self.assertFalse(self.output.exists())

    def test_unsupported_extension(self):
        path = self.base / "image.svg"
        path.write_text("<svg/>")
        with self.assertRaises(ConfigError) as error:
            extraction.extract_frames(path, self.output)
        self.assertEqual(error.exception.code, "UNSUPPORTED_TYPE")

    def test_input_and_ancestor_symlinks_rejected(self):
        direct = self.base / "linked.mp4"
        direct.symlink_to(self.root / "vertical.mp4")
        ancestor = self.base / "alias"
        ancestor.symlink_to(self.root, target_is_directory=True)
        for path in (direct, ancestor / "vertical.mp4"):
            with self.subTest(path=path), self.assertRaises(ConfigError):
                extraction.extract_frames(path, self.output)

    def test_output_symlinks_never_write_outside(self):
        outside = self.base / "outside"
        outside.mkdir()
        sentinel = outside / "frame-0001.jpg"
        sentinel.write_bytes(b"preserve me")
        self.output.symlink_to(outside, target_is_directory=True)
        for target in (self.output, self.output / "nested"):
            with self.subTest(target=target), self.assertRaises(ConfigError):
                self.extract(output=target)
        self.assertEqual(sentinel.read_bytes(), b"preserve me")
        self.assertEqual(list(outside.iterdir()), [sentinel])

    def test_existing_output_and_file_symlink_are_not_overwritten(self):
        outside = self.base / "important.txt"
        outside.write_bytes(b"preserve me")
        self.output.mkdir()
        (self.output / "frame-0001.jpg").symlink_to(outside)
        with self.assertRaises(ConfigError) as error:
            self.extract()
        self.assertEqual(error.exception.code, "OUTPUT_NOT_EMPTY")
        self.assertEqual(outside.read_bytes(), b"preserve me")

    def test_existing_empty_directory(self):
        self.output.mkdir()
        self.assert_manifest(self.extract())

    def test_cleanup_after_partial_extraction_failure(self):
        def broken(fd, demuxer, stage_fd, selected, image):
            Path(extraction._fd_path(stage_fd), "frame-0001.jpg").write_bytes(b"partial")
            raise subprocess.CalledProcessError(1, ["ffmpeg"])
        with patch.object(extraction, "_extract", side_effect=broken):
            with self.assertRaises(ConfigError):
                self.extract()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_cleanup_after_partial_publication_failure(self):
        original = os.link
        count = 0

        def broken(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("injected publication failure")
            return original(*args, **kwargs)

        with patch.object(extraction.os, "link", side_effect=broken):
            with self.assertRaises(ConfigError):
                self.extract(maximum=3)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_timeout_removes_partial_evidence(self):
        def timeout(fd, demuxer, stage_fd, selected, image):
            Path(extraction._fd_path(stage_fd), "frame-0001.jpg").write_bytes(b"partial")
            raise subprocess.TimeoutExpired(["ffmpeg"], extraction.TIMEOUT_SECONDS)
        with patch.object(extraction, "_extract", side_effect=timeout):
            with self.assertRaises(ConfigError) as error:
                self.extract()
        self.assertEqual(error.exception.code, "EXTRACTION_TIMEOUT")
        self.assertEqual(list(self.output.iterdir()), [])

    def test_source_changed_during_extraction_cannot_publish(self):
        source = self.base / "mutable.mp4"
        shutil.copyfile(self.root / "vertical.mp4", source)
        original = extraction._extract

        def mutate(*args):
            original(*args)
            with source.open("ab") as stream:
                stream.write(b"changed")

        with patch.object(extraction, "_extract", side_effect=mutate):
            with self.assertRaises(ConfigError) as error:
                extraction.extract_frames(source, self.output, 2)
        self.assertEqual(error.exception.code, "INPUT_CHANGED")
        self.assertEqual(list(self.output.iterdir()), [])

    def test_packet_and_duration_limits(self):
        info = {"packets": [{"pts_time": "0", "duration_time": "0.1"}], "streams": [{}]}
        with patch.object(extraction, "MAX_PACKETS", 0):
            with self.assertRaises(ConfigError):
                extraction._duration(info)
        info["packets"][0]["duration_time"] = "601"
        with self.assertRaises(ConfigError):
            extraction._duration(info)

    def test_duplicate_timestamps_are_not_selected(self):
        manifest = self.extract(maximum=64)
        self.assert_manifest(manifest, 64)
        timestamps = [frame["timestampMs"] for frame in manifest["frames"]]
        self.assertTrue(all(b - a >= 50 for a, b in zip(timestamps, timestamps[1:])))

    def test_invalid_max_frames_and_parent_traversal(self):
        for maximum in (0, -1, 65, 1.5, True):
            with self.subTest(maximum=maximum), self.assertRaises(ConfigError):
                self.extract(maximum=maximum)
        with self.assertRaises(ConfigError):
            self.extract(output=self.base / ".." / "escape")

    def test_disguised_playlist_cannot_read_another_file(self):
        playlist = self.base / "disguised.mp4"
        playlist.write_text("ffconcat version 1.0\nfile '" + str(self.root / "vertical.mp4") + "'\n")
        with self.assertRaises(ConfigError):
            extraction.extract_frames(playlist, self.output)
        self.assertFalse(self.output.exists())

    def test_ffmpeg_contract_no_shell_network_or_external_references(self):
        real_process = extraction.process
        calls = []

        def checked(args, **kwargs):
            calls.append(args)
            self.assertIsInstance(args, list)
            self.assertNotIn("shell", kwargs)
            self.assertEqual(args[args.index("-protocol_whitelist") + 1], "file")
            demuxer = args[args.index("-f") + 1]
            self.assertIn(demuxer, extraction.FORMATS.values())
            if demuxer == "mov":
                self.assertEqual(args[args.index("-enable_drefs") + 1], "0")
                self.assertEqual(args[args.index("-use_absolute_path") + 1], "0")
            self.assertTrue(args[args.index("-i") + 1].startswith("/proc/self/fd/"))
            return real_process(args, **kwargs)

        with patch.object(extraction, "process", side_effect=checked):
            self.extract(maximum=2)
        self.assertGreaterEqual(len(calls), 4)

    def test_cli_errors_are_json_without_absolute_paths(self):
        result = subprocess.run([
            sys.executable, str(ROOT / "scripts/extract_frames.py"),
            "--input", str(self.base / "missing.mp4"), "--output", str(self.output),
        ], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 1)
        self.assertIn("error", json.loads(result.stdout))
        self.assertNotIn(str(self.base), result.stdout)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
