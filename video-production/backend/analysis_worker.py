#!/usr/bin/env python3
"""Private sequential analysis worker. No HTTP listener or render queue access."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import threading
import time

from studio import Studio
import extract_frames as extraction
from production import fail
from vision_provider import VisionProvider, SCHEMA_VERSION

STRATEGY_VERSION = "visual-local-v2-frames3"
EXTRACTOR_VERSION = "frames-v1"


class Heartbeat:
    """Own SQLite connection: never share Studio connections between threads."""
    def __init__(self, root, job, interval=None):
        self.root, self.job = root, job
        self.interval = interval or max(0.1, job["lease_seconds"] / 3)
        self.stop, self.lost = threading.Event(), threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        studio = None
        try:
            studio = Studio(self.root)
            while not self.stop.wait(self.interval):
                if not studio.heartbeat_analysis(self.job["id"], self.job["lease_token"]):
                    self.lost.set()
                    return
        except Exception:
            self.lost.set()
        finally:
            if studio is not None:
                studio.close()

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join()


def _snapshot(studio, asset, workspace):
    """Private, verified source copy prevents source mutation during extraction."""
    source = studio.root / asset["storage_path"]
    target = workspace / ("source-" + asset["id"] + source.suffix)
    digest = hashlib.sha256()
    with extraction._source(source) as (fd, stat):
        out = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(out, "wb") as dest, os.fdopen(os.dup(fd), "rb") as src:
            total = 0
            while chunk := src.read(65536):
                total += len(chunk)
                if total > min(stat.st_size, 1024**3):
                    fail("ASSET_INTEGRITY", "Source changed during snapshot.")
                digest.update(chunk)
                dest.write(chunk)
        if digest.hexdigest() != asset["sha256"]:
            fail("ASSET_INTEGRITY", "Snapshot hash mismatch.")
    return target


def run_one(studio, node, provider, *, lease_seconds=600):
    """One claim, sequential assets, one atomic publication. Returns whether claimed."""
    job = studio.claim_analysis(node, lease_seconds=lease_seconds)
    if not job:
        return False
    workspace = None
    try:
        if (job["strategy_version"], job["extractor_version"]) != (STRATEGY_VERSION, EXTRACTOR_VERSION):
            fail("ANALYSIS_VERSION_UNSUPPORTED", "Worker cannot execute this strategy version.")
        with Heartbeat(studio.root, job) as heartbeat:
            prepared = studio.prepare_analysis(job["id"], job["lease_token"])
            if prepared is None:
                return True
            workspace = studio.analysis_workspace(job["id"], job["lease_token"])
            frames, results = [], []
            assets = prepared["assets"]
            for position, asset in enumerate(assets):
                if heartbeat.lost.is_set() or studio.prepare_analysis(job["id"], job["lease_token"]) is None:
                    return True
                if asset["asset_type"] not in ("image", "video"):
                    fail("ANALYSIS_MEDIA_UNSUPPORTED", "Only images and videos can be analyzed.")
                source = _snapshot(studio, asset, workspace)
                directory = workspace / asset["id"]
                # Respect the existing 256-frame atomic publication ceiling,
                # reserving at least one frame for every remaining asset.
                limit = min(3, 256 - len(frames) - (len(assets) - position - 1))
                manifest = extraction.extract_frames(source, directory, max_frames=limit)
                source.unlink()
                images, hashes = [], []
                for index, frame in enumerate(manifest["frames"], 1):
                    with extraction._source(directory / f"frame-{index:04d}.jpg") as (fd, _):
                        with os.fdopen(os.dup(fd), "rb") as stream:
                            data = stream.read(8 * 1024 * 1024 + 1)
                    digest = hashlib.sha256(data).hexdigest()
                    if digest != frame["sha256"]:
                        fail("ANALYSIS_EVIDENCE_MISMATCH", "Extracted frame changed.")
                    images.append(data)
                    hashes.append(digest)
                    frames.append({"asset_id": asset["id"], "frame_index": index,
                                   "timestamp_ms": frame["timestampMs"]})
                # Recheck after extraction, immediately before sending private pixels.
                if heartbeat.lost.is_set() or studio.prepare_analysis(job["id"], job["lease_token"]) is None:
                    return True
                observation = provider.analyze_asset(images)
                width, height = manifest["frames"][0]["width"], manifest["frames"][0]["height"]
                observation["semantic"]["orientation"] = ("vertical" if height > width else "horizontal" if width > height else "square")
                results.append({"asset_id": asset["id"], "schema_version": SCHEMA_VERSION,
                                "status": observation["status"], "semantic": observation["semantic"],
                                "provider": provider.provider, "model": provider.model,
                                "evidence_sha256": hashes})
            if not heartbeat.lost.is_set():
                studio.finish_analysis(job["id"], job["lease_token"], frames=frames, results=results)
    except Exception as exc:
        # Persist bounded codes, never private paths, prompts or HTTP response bodies.
        code = getattr(exc, "code", "ANALYSIS_WORKER_ERROR")
        studio.finish_analysis(job["id"], job["lease_token"], error=code)
    finally:
        if workspace is not None:
            shutil.rmtree(workspace)
    return True


@contextmanager
def worker_lock(root):
    fd = os.open(Path(root) / ".analysis-worker.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage", required=True)
    parser.add_argument("--node", default="local-analysis-1")
    parser.add_argument("--endpoint", default="http://127.0.0.1:8788/v1/chat/completions")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    provider = VisionProvider(args.endpoint)
    studio = Studio(args.storage)
    try:
        with worker_lock(studio.root):
            while True:
                worked = run_one(studio, args.node, provider)
                if args.once:
                    break
                if not worked:
                    time.sleep(2)
    finally:
        studio.close()


if __name__ == "__main__":
    main()
