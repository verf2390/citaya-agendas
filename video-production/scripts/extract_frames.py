#!/usr/bin/env python3
"""Deterministic local evidence extraction (Linux / FFmpeg 6+).

Usage: python extract_frames.py --input clip.mp4 --output frames --max-frames 8
The output's parent must exist; output must be absent or empty. No overwrites.
Top-level dimensions describe the encoded source; frame dimensions describe the
oriented, square-pixel JPEG proxies. Video timestamps are decoded presentation
timestamps relative to the first frame, rounded to milliseconds (not seek times).

Uniform candidates plus scene changes at 320px are reduced to a coverage grid.
Byte-identical JPEG evidence is deduplicated, keeping its earliest timestamp.
Black-frame avoidance and perceptual duplicate detection are intentionally absent.
Images produce their first decoded frame only. Byte determinism assumes the same
FFmpeg build. This CLI is a local file utility, not a tenant authorization boundary.
Limits: 1 GiB input, 40 MP, 600s, 100000 video packets, 64 output frames,
and 120s per subprocess. Existing nonempty output directories are rejected.
"""

import argparse
from contextlib import contextmanager
from fractions import Fraction
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import uuid

from production import ConfigError, digest, fail, process

FORMATS = {
    ".mp4": "mov", ".mov": "mov", ".webm": "matroska",
    ".jpg": "jpeg_pipe", ".jpeg": "jpeg_pipe", ".png": "png_pipe",
    ".webp": "webp_pipe",
}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
MAX_FRAMES = 64
MAX_BYTES = 1024 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_SECONDS = 600
MAX_PACKETS = 100_000
TIMEOUT_SECONDS = 120
SCENE_THRESHOLD = 0.30


def _parts(value):
    path = Path(value).absolute()
    if ".." in path.parts:
        fail("UNSAFE_PATH", "Parent traversal is not allowed.")
    return path


def _directory(path):
    """Walk with openat/O_NOFOLLOW, including every ancestor, avoiding races."""
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def _source(path):
    parent = _directory(path.parent)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=parent)
    finally:
        os.close(parent)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_BYTES:
            fail("INVALID_INPUT", "Input must be a nonempty regular file, at most 1 GiB.")
        yield fd, info
    finally:
        os.close(fd)


@contextmanager
def _output(path):
    parent = _directory(path.parent)
    try:
        try:
            os.mkdir(path.name, mode=0o700, dir_fd=parent)
        except FileExistsError:
            pass
        fd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                     dir_fd=parent)
    finally:
        os.close(parent)
    stage_fd = None
    stage_name = None
    published = []
    try:
        if os.listdir(fd):
            fail("OUTPUT_NOT_EMPTY", "Output must be an empty directory.")
        stage_name = ".extract-" + uuid.uuid4().hex
        os.mkdir(stage_name, mode=0o700, dir_fd=fd)
        stage_fd = os.open(stage_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                           dir_fd=fd)
        yield fd, stage_fd, published
    except BaseException:
        for name, inode in published:
            # Never remove a path replaced by another process during rollback.
            try:
                if os.stat(name, dir_fd=fd, follow_symlinks=False).st_ino == inode:
                    os.unlink(name, dir_fd=fd)
            except FileNotFoundError:
                pass
        raise
    finally:
        if stage_fd is not None:
            os.close(stage_fd)
        if stage_name is not None:
            shutil.rmtree(stage_name, dir_fd=fd)
        os.close(fd)


def _fd_path(fd):
    return "/proc/self/fd/" + str(fd)


def _input_args(fd, demuxer):
    # Force a single-file container: disguised playlists/image sequences cannot
    # activate other demuxers. MOV's external data references stay disabled.
    args = ["-protocol_whitelist", "file", "-max_pixels", str(MAX_PIXELS),
            "-threads", "1", "-f", demuxer]
    if demuxer == "mov":
        args += ["-enable_drefs", "0", "-use_absolute_path", "0"]
    return args + ["-i", _fd_path(fd)]


def _run(args, fds):
    # Reuse the established minimal environment and argv-only subprocess helper.
    return process(args, pass_fds=tuple(fds), capture_output=True, text=True,
                   timeout=TIMEOUT_SECONDS, stdin=subprocess.DEVNULL)


def _probe(fd, demuxer, timeline=False):
    # production.probe auto-detects formats and allows file/pipe. Here the forced
    # demuxer is essential to the single-input boundary, so only process is reused.
    entries = "stream=width,height,duration,sample_aspect_ratio:format=duration"
    extra = []
    if timeline:
        # Container duration can end before the last presentation timestamp in
        # VFR/B-frame files. Read a bounded video-only packet timeline instead.
        entries += ":packet=pts_time,duration_time,flags"
        extra = ["-show_packets", "-read_intervals", f"%+#{MAX_PACKETS + 1}"]
    result = _run([
        "ffprobe", "-v", "error", "-max_alloc", "268435456", *_input_args(fd, demuxer),
        "-select_streams", "v:0", *extra, "-show_entries", entries,
        "-of", "json",
    ], [fd])
    return json.loads(result.stdout)


def _duration(info):
    packets = info.get("packets", [])
    if not packets or len(packets) > MAX_PACKETS:
        fail("MEDIA_SAFETY_LIMIT", "Missing video timeline or more than 100000 packets.")
    visible = [p for p in packets if "D" not in p.get("flags", "")]
    points = [(Fraction(p["pts_time"]), Fraction(p.get("duration_time", "0")))
              for p in visible]
    if not points:
        fail("INVALID_TIMELINE", "Video has no presentation timestamps.")
    start = min(t for t, _ in points)
    last = max(points, key=lambda point: point[0])
    if last[1] <= 0:
        # Some containers omit packet duration. Only use the declared video or
        # container duration when it actually covers the final presentation.
        declared = info["streams"][0].get("duration") or info.get("format", {}).get("duration", "0")
        seconds = Fraction(declared)
        if seconds <= last[0] - start:
            fail("INVALID_TIMELINE", "Final frame duration is unavailable.")
    else:
        seconds = max(t + max(d, 0) for t, d in points) - start
    if not 0 < seconds <= MAX_SECONDS:
        fail("MEDIA_SAFETY_LIMIT", "Video duration must be positive and at most 600s.")
    return math.ceil(seconds * 1000)


def _ffmpeg(fd, demuxer):
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
            "-xerror", "-max_alloc", "268435456", *_input_args(fd, demuxer),
            "-map", "0:v:0", "-an", "-sn", "-dn", "-filter_threads", "1"]


def _scale(limit):
    # Correct non-square pixels without increasing either encoded dimension.
    # Autorotation runs before this filter, including the pixel aspect ratio.
    sar = "if(gt(sar,0),sar,1)"
    width = f"iw*min(1,{sar})"
    height = f"ih/max(1,{sar})"
    factor = f"min(1,{limit}/max({width},{height}))"
    return (f"scale=w='max(1,trunc({width}*{factor}))':"
            f"h='max(1,trunc({height}*{factor}))',setsar=1")


def _candidates(fd, demuxer, stage_fd, duration_ms, maximum):
    duration = duration_ms / 1000
    step = duration / (2 * maximum)
    gap = max(0.05, duration / (4 * maximum))
    selection = (
        f"isnan(prev_selected_t)+gte(t-prev_selected_t,{gap:.9f})*"
        f"(gt(floor(t/{step:.9f}),floor(prev_selected_t/{step:.9f}))"
        f"+gte(scene,{SCENE_THRESHOLD}))"
    )
    metadata_path = _fd_path(stage_fd) + "/candidates.txt"
    filters = ("settb=1/1000000,setpts=PTS-STARTPTS," + _scale(320)
               + ",select='" + selection + "',metadata=mode=print:file=" + metadata_path)
    _run([*_ffmpeg(fd, demuxer), "-vf", filters, "-fps_mode", "vfr",
          "-f", "null", "-"], [fd, stage_fd])
    candidates = []
    for line in Path(metadata_path).read_text().splitlines():
        match = re.match(r"frame:\s*\d+\s+pts:\s*(-?\d+)\s+pts_time:", line)
        if match:
            candidates.append({"pts": int(match.group(1)), "scene": 0.0})
        elif line.startswith("lavfi.scene_score=") and candidates:
            candidates[-1]["scene"] = float(line.split("=", 1)[1])
    if not candidates or len(candidates) > 4 * maximum + 4:
        fail("INVALID_TIMELINE", "No usable bounded video timeline.")
    if any(c["pts"] < 0 or c["pts"] >= duration_ms * 1000 for c in candidates):
        fail("INVALID_TIMELINE", "Decoded timestamps exceed the reported duration.")
    if any(a["pts"] >= b["pts"] for a, b in zip(candidates, candidates[1:])):
        fail("INVALID_TIMELINE", "Decoded timestamps must increase.")
    return candidates


def _select(candidates, maximum):
    if len(candidates) <= maximum:
        return candidates
    if maximum == 1:
        return candidates[:1]
    chosen = {0, len(candidates) - 1}
    span = candidates[-1]["pts"] - candidates[0]["pts"]
    spacing = span / (maximum - 1)
    for index in range(1, maximum - 1):
        target = candidates[0]["pts"] + index * spacing
        available = [i for i in range(len(candidates)) if i not in chosen]
        # Prefer a nearby cut, but never sacrifice an entire coverage interval.
        nearby_cuts = [i for i in available
                       if candidates[i]["scene"] >= SCENE_THRESHOLD
                       and abs(candidates[i]["pts"] - target) <= spacing / 3]
        winner = min(nearby_cuts or available,
                     key=lambda i: (abs(candidates[i]["pts"] - target), i))
        chosen.add(winner)
    return [candidates[i] for i in sorted(chosen)]


def _extract(fd, demuxer, stage_fd, selected, image):
    filters = "settb=1/1000000,setpts=PTS-STARTPTS,"
    if not image:
        filters += "select='" + "+".join(f"eq(pts,{c['pts']})" for c in selected) + "',"
    filters += _scale(1280)
    _run([*_ffmpeg(fd, demuxer), "-vf", filters, "-fps_mode", "vfr",
          "-frames:v", str(len(selected)), "-map_metadata", "-1",
          "-c:v", "mjpeg", "-threads", "1", "-q:v", "3", "-pix_fmt", "yuvj444p",
          "-f", "image2", _fd_path(stage_fd) + "/frame-%04d.jpg"], [fd, stage_fd])


def extract_frames(input_path, output_dir, max_frames=8):
    """Return a JSON-serializable manifest; fail without leaving partial frames."""
    if type(max_frames) is not int or not 1 <= max_frames <= MAX_FRAMES:
        fail("INVALID_MAX_FRAMES", "max-frames must be between 1 and 64.")
    source = _parts(input_path)
    output = _parts(output_dir)
    demuxer = FORMATS.get(source.suffix.lower())
    if demuxer is None:
        fail("UNSUPPORTED_TYPE", "Unsupported image/video extension.")
    image = source.suffix.lower() not in VIDEO_EXTENSIONS
    try:
        with _source(source) as (fd, initial):
            info = _probe(fd, demuxer, timeline=not image)
            streams = info.get("streams", [])
            if len(streams) != 1:
                fail("INVALID_MEDIA", "A decodable video/image stream is required.")
            stream = streams[0]
            width, height = stream.get("width", 0), stream.get("height", 0)
            if min(width, height) <= 0 or width * height > MAX_PIXELS:
                fail("MEDIA_SAFETY_LIMIT", "Invalid dimensions or source above 40 MP.")
            # A finite positive SAR is required before constructing scale filters.
            sar = stream.get("sample_aspect_ratio", "1:1")
            if sar not in ("N/A", "0:1") and not 0 < Fraction(sar.replace(":", "/")) <= 100:
                fail("INVALID_MEDIA", "Invalid pixel aspect ratio.")
            duration_ms = 0
            if not image:
                duration_ms = _duration(info)
            with _output(output) as (out_fd, stage_fd, published):
                selected = ([{"pts": 0, "scene": 0.0}] if image else
                            _select(_candidates(fd, demuxer, stage_fd, duration_ms, max_frames), max_frames))
                _extract(fd, demuxer, stage_fd, selected, image)
                frames = []
                seen_hashes = set()
                for index, candidate in enumerate(selected, 1):
                    name = f"frame-{index:04d}.jpg"
                    proxy_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=stage_fd)
                    try:
                        proxy = _probe(proxy_fd, "jpeg_pipe")["streams"][0]
                        sha256 = digest(_fd_path(proxy_fd))
                        if sha256 in seen_hashes:
                            os.unlink(name, dir_fd=stage_fd)
                            continue
                        seen_hashes.add(sha256)
                        evidence_id = f"frame-{len(frames) + 1:04d}"
                        target = evidence_id + ".jpg"
                        if target != name:
                            os.rename(name, target, src_dir_fd=stage_fd, dst_dir_fd=stage_fd)
                        frames.append({
                            "id": evidence_id,
                            "timestampMs": (candidate["pts"] + 500) // 1000,
                            "width": proxy["width"], "height": proxy["height"],
                            "sha256": sha256, "path": target,
                        })
                    finally:
                        os.close(proxy_fd)
                current = os.fstat(fd)
                if (initial.st_size, initial.st_mtime_ns, initial.st_ctime_ns) != (
                        current.st_size, current.st_mtime_ns, current.st_ctime_ns):
                    fail("INPUT_CHANGED", "Input changed during extraction.")
                for frame in frames:
                    name = frame["path"]
                    os.chmod(name, 0o600, dir_fd=stage_fd)
                    os.link(name, name, src_dir_fd=stage_fd, dst_dir_fd=out_fd,
                            follow_symlinks=False)
                    published.append((name, os.stat(name, dir_fd=stage_fd).st_ino))
                return {
                    "version": 1, "sourceType": "image" if image else "video",
                    "durationMs": duration_ms, "width": width, "height": height,
                    "strategy": "single-image" if image else "uniform+scene-change",
                    "frames": frames,
                }
    except ConfigError:
        raise
    except subprocess.TimeoutExpired:
        fail("EXTRACTION_TIMEOUT", "Media processing exceeded its time limit.")
    except subprocess.CalledProcessError:
        fail("INVALID_MEDIA", "Media could not be decoded.")
    except (OSError, ValueError, KeyError, IndexError, ZeroDivisionError):
        fail("EXTRACTION_FAILED", "Invalid media or unsafe/inaccessible filesystem path.")


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        fail("INVALID_ARGUMENTS", "Invalid extraction arguments.")


def main():
    parser = _Parser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-frames", type=int, default=8)
    try:
        args = parser.parse_args()
        result = extract_frames(args.input, args.output, args.max_frames)
    except ConfigError as exc:
        print(json.dumps({"error": {"code": exc.code, "message": str(exc)}}))
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
