#!/usr/bin/env python3
"""Sequential local benchmark. Prints metrics only, never media or semantic text."""
import argparse
import json
import os
from pathlib import Path
import resource
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import extract_frames as extraction
from vision_provider import VisionProvider


def benchmark(inputs, provider, max_frames=6, server_pid=None):
    if not 1 <= len(inputs) <= 8 or type(max_frames) is not int or not 1 <= max_frames <= 6:
        raise ValueError("Use 1–8 inputs and 1–6 frames")
    if server_pid is not None and (type(server_pid) is not int or server_pid <= 0):
        raise ValueError("Invalid server PID")
    stop = threading.Event()
    peak = [None]
    def monitor():
        while not stop.is_set():
            try:
                lines = Path(f"/proc/{server_pid}/status").read_text().splitlines()
                value = int(next(line for line in lines if line.startswith("VmRSS:")).split()[1])
                peak[0] = max(peak[0] or 0, value)
            except (OSError, ValueError, StopIteration):
                return
            stop.wait(0.1)
    thread = threading.Thread(target=monitor, daemon=True) if server_pid else None
    if thread:
        thread.start()
    started, records = time.monotonic(), []
    try:
        for index, source in enumerate(inputs, 1):
            before = time.monotonic()
            record = {"assetNumber": index, "frames": 0}
            try:
                with tempfile.TemporaryDirectory(prefix="citaya-vision-benchmark-") as stage:
                    directory = Path(stage) / "frames"
                    manifest = extraction.extract_frames(source, directory, max_frames=max_frames)
                    images = []
                    for n, _ in enumerate(manifest["frames"], 1):
                        with extraction._source(directory / f"frame-{n:04d}.jpg") as (fd, _):
                            with os.fdopen(os.dup(fd), "rb") as stream:
                                images.append(stream.read(8 * 1024 * 1024 + 1))
                    record["frames"] = len(images)
                    inference = time.monotonic()
                    result = provider.analyze_asset(images)
                    record.update(status=result["status"], inferenceSeconds=round(time.monotonic() - inference, 3))
            except Exception as exc:
                record.update(status="failed", errorCode=getattr(exc, "code", "BENCHMARK_ERROR"))
            record["totalSeconds"] = round(time.monotonic() - before, 3)
            records.append(record)
    finally:
        stop.set()
        if thread:
            thread.join()
    return {"model": provider.model, "provider": provider.provider, "assets": len(inputs),
            "frames": sum(r["frames"] for r in records), "totalSeconds": round(time.monotonic() - started, 3),
            "counts": {status: sum(r["status"] == status for r in records) for status in ("unknown", "partial", "complete", "failed")},
            "clientLifetimePeakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "serverSampledPeakRssKiB": peak[0], "perAsset": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, action="append", type=Path)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8788/v1/chat/completions")
    parser.add_argument("--max-frames", default=6, type=int, choices=range(1, 7))
    parser.add_argument("--server-pid", type=int)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        report = benchmark(args.input, VisionProvider(args.endpoint), args.max_frames, args.server_pid)
    except Exception as exc:
        print(json.dumps({"errorCode": getattr(exc, "code", "BENCHMARK_INVALID_ARGUMENTS")}))
        return 1
    print(json.dumps(report, sort_keys=True))
    return 1 if report["counts"]["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
