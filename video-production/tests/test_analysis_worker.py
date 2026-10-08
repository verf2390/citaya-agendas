"""Real extraction + SQLite with a fake, offline model; no model needed in CI."""
import hashlib
import json
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "scripts")]
import analysis_worker as worker
import test_media_analysis as persistence
from test_vision_provider import observation
from vision_provider import MODEL, PROVIDER, VisionError, validate_semantic


class FakeProvider:
    provider, model = PROVIDER, MODEL

    def __init__(self, callback=None, value=None):
        self.callback, self.value, self.calls = callback, value, 0

    def analyze_asset(self, frames):
        assert all(isinstance(frame, bytes) for frame in frames)
        assert 1 <= len(frames) <= 3
        self.calls += 1
        if self.callback:
            self.callback()
        semantic, status = validate_semantic(self.value or observation(), [f"evidence-{n}" for n in range(1, len(frames) + 1)])
        return {"semantic": semantic, "status": status}


class AnalysisWorkerTests(unittest.TestCase):
    # Reuse fixture construction, not the persistence test methods themselves.
    setUpClass = classmethod(persistence.MediaAnalysisTests.setUpClass.__func__)
    setUp = persistence.MediaAnalysisTests.setUp
    approve = persistence.MediaAnalysisTests.approve
    rows = persistence.MediaAnalysisTests.rows
    expire = persistence.MediaAnalysisTests.expire
    change_hash = persistence.MediaAnalysisTests.change_hash
    assert_error = persistence.MediaAnalysisTests.assert_error

    def enqueue(self, assets=None):
        approval = self.approve(assets)
        self.approval = approval
        self.job = self.s.enqueue_analysis(self.a, self.pa, approval, "test-worker",
                                           strategy_version=worker.STRATEGY_VERSION,
                                           extractor_version=worker.EXTRACTOR_VERSION)
        return self.job

    def run_job(self, provider=None):
        return worker.run_one(self.s, "test", provider or FakeProvider())

    def test_complete_real_extractor_persistence_and_evidence(self):
        self.enqueue()
        self.assertTrue(self.run_job())
        self.assertEqual(self.s.analysis_job(self.a, self.job)["status"], "completed")
        frames = self.s.analysis_frames(self.a, self.job)
        self.assertEqual(len(frames), 1)  # Images remain a single evidence frame.
        result = self.s.analysis_results(self.a, self.job)[0]
        body = json.loads(result["result_json"])
        self.assertEqual(result["provider"], PROVIDER)
        self.assertEqual(result["model"], MODEL)
        self.assertEqual(body["status"], "complete")
        self.assertEqual(body["evidence"][0]["frameId"], frames[0]["id"])
        self.assertEqual(body["evidence"][0]["timestampMs"], frames[0]["timestamp_ms"])
        self.assertEqual(frames[0]["timestamp_ms"], 0)
        self.assertEqual(frames[0]["sha256"], hashlib.sha256((self.root / frames[0]["storage_path"]).read_bytes()).hexdigest())
        self.assertFalse(list(self.root.glob("**/work/analysis/*/*")))
        visual = self.s.visual_inventory(self.a, self.pa)[self.asset]
        self.assertEqual(visual["actions"], ["tool_work"])
        for forbidden in ("sha256", "storage_path", "tenant_id", "project_id", "frameId"):
            self.assertNotIn(forbidden, json.dumps(visual))

    def test_partial(self):
        self.enqueue()
        value = observation()
        value["unknowns"] = ["Exact service is unclear"]
        self.run_job(FakeProvider(value=value))
        self.assertEqual(self.rows("video_analysis_results")[0]["status"], "partial")

    def test_unknown_without_invented_semantics(self):
        self.enqueue()
        value = observation()
        value["evidence"] = []
        self.run_job(FakeProvider(value=value))
        row = self.rows("video_analysis_results")[0]
        self.assertEqual(row["status"], "unknown")
        self.assertEqual(json.loads(row["result_json"])["semantic"]["summary"], "")

    def test_revocation_before_claim_prevents_extraction(self):
        self.enqueue()
        self.s.revoke_media_set(self.a, self.approval)
        with patch.object(worker.extraction, "extract_frames") as extract:
            self.assertFalse(self.run_job())
            extract.assert_not_called()

    def test_revocation_after_claim_before_extraction(self):
        self.enqueue()
        original = self.s.analysis_workspace
        def revoke(*args):
            path = original(*args)
            self.s.revoke_media_set(self.a, self.approval)
            return path
        with patch.object(self.s, "analysis_workspace", side_effect=revoke), patch.object(worker.extraction, "extract_frames") as extract:
            self.run_job()
            extract.assert_not_called()
        self.assertEqual(self.rows("video_analysis_frames"), [])

    def test_revocation_after_extraction_prevents_inference(self):
        self.enqueue()
        original = worker.extraction.extract_frames
        def revoke(*args, **kwargs):
            result = original(*args, **kwargs)
            self.s.revoke_media_set(self.a, self.approval)
            return result
        provider = FakeProvider()
        with patch.object(worker.extraction, "extract_frames", side_effect=revoke):
            self.run_job(provider)
        self.assertEqual(provider.calls, 0)

    def test_revoked_during_inference_cannot_publish(self):
        self.enqueue()
        self.run_job(FakeProvider(callback=lambda: self.s.revoke_media_set(self.a, self.approval)))
        self.assertEqual(self.s.analysis_job(self.a, self.job)["status"], "failed")
        self.assertEqual(self.rows("video_analysis_results"), [])
        self.assertEqual(self.rows("video_analysis_frames"), [])

    def test_hash_changed_during_inference_cannot_publish(self):
        self.enqueue()
        self.run_job(FakeProvider(callback=self.change_hash))
        self.assertEqual(self.rows("video_analysis_results"), [])
        self.assertEqual(self.s.analysis_job(self.a, self.job)["error_code"], "ASSET_INTEGRITY")

    def test_lease_expired_during_inference(self):
        self.enqueue()
        self.run_job(FakeProvider(callback=lambda: self.expire({"id": self.job})))
        self.assertEqual(self.rows("video_analysis_frames"), [])
        self.assertEqual(self.s.analysis_job(self.a, self.job)["error_code"], "LEASE_EXPIRED")

    def test_cancelled_during_inference(self):
        self.enqueue()
        self.run_job(FakeProvider(callback=lambda: self.s.cancel_analysis(self.a, self.job)))
        self.assertEqual(self.rows("video_analysis_results"), [])
        self.assertEqual(self.s.analysis_job(self.a, self.job)["status"], "cancelled")

    def test_old_worker_cannot_publish_after_new_claim(self):
        self.enqueue()
        def replace():
            self.expire({"id": self.job})
            self.s.claim_analysis("reaper")
            self.s.retry_analysis(self.a, self.job)
            self.s.claim_analysis("replacement")
        self.run_job(FakeProvider(callback=replace))
        self.assertEqual(self.rows("video_analysis_results"), [])
        self.assertEqual(self.s.analysis_job(self.a, self.job)["worker_node"], "replacement")

    def test_extractor_failure_and_retry(self):
        self.enqueue()
        with patch.object(worker.extraction, "extract_frames", side_effect=RuntimeError("private input path")):
            self.run_job()
        self.assertEqual(self.s.analysis_job(self.a, self.job)["error_code"], "ANALYSIS_WORKER_ERROR")
        self.assertEqual(self.s.retry_analysis(self.a, self.job), self.job)
        self.run_job()
        self.assertEqual(self.s.analysis_job(self.a, self.job)["status"], "completed")

    def test_provider_failure_is_technical_not_unknown(self):
        self.enqueue()
        def error():
            raise VisionError("VISION_UNAVAILABLE")
        self.run_job(FakeProvider(callback=error))
        self.assertEqual(self.s.analysis_job(self.a, self.job)["error_code"], "VISION_UNAVAILABLE")
        self.assertEqual(self.rows("video_analysis_results"), [])

    def test_heartbeat_uses_independent_connection(self):
        self.enqueue()
        job = self.s.claim_analysis("heartbeat", lease_seconds=2)
        initial = job["lease_until"]
        with worker.Heartbeat(self.root, job, interval=0.1) as heartbeat:
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                if self.s.analysis_job(self.a, self.job)["lease_until"] > initial:
                    break
                time.sleep(0.05)
            self.assertGreater(self.s.analysis_job(self.a, self.job)["lease_until"], initial)
            self.assertFalse(heartbeat.lost.is_set())

    def test_concurrency_lock(self):
        with worker.worker_lock(self.root):
            with self.assertRaises(BlockingIOError):
                with worker.worker_lock(self.root):
                    pass

    def test_inventory_tenant_and_revocation_boundary(self):
        self.enqueue()
        self.run_job()
        self.assert_error("NOT_FOUND", lambda: self.s.visual_inventory(self.b, self.pa))
        self.assertEqual(self.s.visual_inventory(self.a, self.pa2), {})
        self.s.revoke_media_set(self.a, self.approval)
        self.assertEqual(self.s.visual_inventory(self.a, self.pa), {})

    def test_inventory_stale_hash_removed(self):
        self.enqueue()
        self.run_job()
        self.change_hash()
        self.assertEqual(self.s.visual_inventory(self.a, self.pa), {})

    def test_legacy_results_do_not_create_visual_inventory(self):
        self.enqueue()
        job = self.s.claim_analysis("legacy")
        self.s.finish_analysis(job["id"], job["lease_token"], results=[
            {"asset_id": self.asset, "schema_version": "media-evidence-v1", "status": "unknown"}])
        self.assertEqual(self.s.visual_inventory(self.a, self.pa), {})

    def test_video_timestamps_resolved_from_extractor_not_model(self):
        import subprocess
        source = Path(self.temp.name) / "clip.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=5:duration=2",
                        "-c:v", "mpeg4", "-threads", "1", str(source)], check=True, capture_output=True, timeout=30)
        asset = self.s.upload(self.a, self.pa, source)
        self.enqueue([asset])
        class LastEvidence(FakeProvider):
            def analyze_asset(self, frames):
                self.value = observation()
                self.value["evidence"][0]["frameRef"] = f"evidence-{len(frames)}"
                return super().analyze_asset(frames)
        with patch.object(worker.extraction, "extract_frames", wraps=worker.extraction.extract_frames) as extract:
            self.run_job(LastEvidence())
        self.assertEqual(extract.call_args.kwargs["max_frames"], 3)
        frames = sorted(self.s.analysis_frames(self.a, self.job), key=lambda f: f["frame_index"])
        self.assertGreater(len(frames), 1)
        self.assertLessEqual(len(frames), 3)
        self.assertGreater(frames[-1]["timestamp_ms"], 0)
        body = json.loads(self.s.analysis_results(self.a, self.job)[0]["result_json"])
        self.assertEqual(body["evidence"][0]["timestampMs"], frames[-1]["timestamp_ms"])
        self.assertEqual(body["evidence"][0]["frameId"], frames[-1]["id"])

    def test_approved_asset_to_director_selection_end_to_end(self):
        import tenant_brief
        self.enqueue()
        self.run_job()
        inventory = self.s.visual_inventory(self.a, self.pa)
        asset = self.s.row("video_assets", self.a, self.asset)
        metadata = [{"id": self.asset, "assetType": asset["asset_type"], "width": asset["width"],
                     "height": asset["height"], "durationMs": asset["duration_ms"]}]
        config = json.loads(self.s.project(self.a, self.pa)["config_json"])
        config["project"] = {"creativeBrief": "Muestra el proceso real de trabajo con herramientas.", "targetDurationSeconds": 15}
        def choose(_endpoint, _token, payload):
            prompt = payload["input"][0]["text"]
            context = json.loads(prompt.split("CONTEXTO_MEDIOS: ", 1)[1].split(". BRIEF: ", 1)[0])
            selected = next(a for a in context["availableAssets"] if "tool_work" in a["visual"]["actions"])
            return {"text": json.dumps({"hook": "Trabajo real", "secondaryHook": "Nuestro taller", "benefit": "Conoce el proceso",
                    "cta": "Reserva tu hora", "outroSeconds": 2,
                    "scenes": [{"headline": "Nuestro trabajo", "visualIntent": "media", "durationSeconds": 10.5,
                                "assetId": selected["id"]}]}), "toolCalls": []}
        with patch.object(tenant_brief, "gateway_call", side_effect=choose):
            directed, _, _ = tenant_brief.direct_tenant_config(config=config, assets=metadata, visual_inventory=inventory)
        self.assertEqual(directed["scenes"][0]["media"], "asset:" + self.asset)
        # Existing render approval remains a separate gate; the visual worker
        # never enables it implicitly.
        self.assertFalse(directed["mediaApproved"])
        directed["mediaApproved"] = True
        normalized, _ = self.s.validated(self.a, self.pa, directed, "preview")
        self.assertEqual(normalized["scenes"][0]["media"], "asset:" + self.asset)

    def test_benchmark_metrics_do_not_leak_private_media(self):
        import benchmark_vision
        result = benchmark_vision.benchmark([self.jpeg], FakeProvider(), server_pid=__import__("os").getpid())
        self.assertEqual(result["counts"]["complete"], 1)
        self.assertEqual(result["frames"], 1)
        self.assertGreater(result["clientLifetimePeakRssKiB"], 0)
        self.assertGreater(result["serverSampledPeakRssKiB"], 0)
        serialized = json.dumps(result)
        for forbidden in (str(self.jpeg), "tool_work", "summary", "base64", self.asset):
            self.assertNotIn(forbidden, serialized)

    def test_inference_frame_tampering_fails_closed(self):
        self.enqueue()
        def tamper():
            frame = next(self.root.glob("**/work/analysis/*/*/*/frame-0001.jpg"))
            # Another valid JPEG, so failure must come from identity comparison.
            frame.write_bytes(self.jpeg.read_bytes())
        self.run_job(FakeProvider(callback=tamper))
        self.assertEqual(self.s.analysis_job(self.a, self.job)["error_code"], "ANALYSIS_EVIDENCE_MISMATCH")
        self.assertEqual(self.rows("video_analysis_results"), [])

    def test_director_save_atomically_revalidates_inventory(self):
        self.enqueue()
        self.run_job()
        inventory = self.s.visual_inventory(self.a, self.pa)
        config = json.loads(self.s.project(self.a, self.pa)["config_json"])
        self.s.update_project(self.a, self.pa, config, expected_visual_inventory=inventory)
        revision = self.s.project(self.a, self.pa)["revision"]
        self.s.revoke_media_set(self.a, self.approval)
        self.assert_error("DIRECTOR_VISUAL_STALE", lambda: self.s.update_project(
            self.a, self.pa, config, expected_visual_inventory=inventory))
        self.assertEqual(self.s.project(self.a, self.pa)["revision"], revision)

    def test_new_unknown_supersedes_previous_complete(self):
        self.enqueue()
        self.run_job()
        self.s.enqueue_analysis(self.a, self.pa, self.approval, "second-attempt",
                                strategy_version=worker.STRATEGY_VERSION, extractor_version=worker.EXTRACTOR_VERSION)
        value = observation()
        value["evidence"] = []
        self.run_job(FakeProvider(value=value))
        self.assertEqual(self.s.visual_inventory(self.a, self.pa)[self.asset]["status"], "unknown")
        self.assertEqual(self.s.visual_inventory(self.a, self.pa)[self.asset]["actions"], [])

    def test_new_strategy_rejects_legacy_frames6_job(self):
        self.assertEqual(worker.STRATEGY_VERSION, "visual-local-v2-frames3")
        approval = self.approve()
        job = self.s.enqueue_analysis(self.a, self.pa, approval, "legacy",
                                      strategy_version="visual-local-v1-frames6",
                                      extractor_version=worker.EXTRACTOR_VERSION)
        with patch.object(worker.extraction, "extract_frames") as extract:
            self.run_job()
            extract.assert_not_called()
        self.assertEqual(self.s.analysis_job(self.a, job)["error_code"], "ANALYSIS_VERSION_UNSUPPORTED")
        # A distinct strategy can use the same approval without mutating the old job.
        new_job = self.s.enqueue_analysis(self.a, self.pa, approval, "new-strategy",
                                          strategy_version=worker.STRATEGY_VERSION,
                                          extractor_version=worker.EXTRACTOR_VERSION)
        self.assertNotEqual(job, new_job)

    def test_benchmark_defaults_to_three_and_allows_six(self):
        import benchmark_vision
        for options, expected in (({}, 3), ({"max_frames": 6}, 6)):
            with patch.object(worker.extraction, "extract_frames", wraps=worker.extraction.extract_frames) as extract:
                result = benchmark_vision.benchmark([self.jpeg], FakeProvider(), **options)
            self.assertEqual(extract.call_args.kwargs["max_frames"], expected)
            self.assertEqual(result["inferenceAttempts"], 1)

    def test_benchmark_counts_both_inferences_on_success_and_failure(self):
        import benchmark_vision
        from vision_provider import VisionProvider
        provider = VisionProvider()
        with patch.object(provider, "_infer", side_effect=[
                VisionError("VISION_INVALID_CONTRACT"), {"semantic": observation(), "status": "complete"},
                VisionError("VISION_INVALID_CONTRACT"), VisionError("VISION_INVALID_CONTRACT")]):
            result = benchmark_vision.benchmark([self.jpeg, self.jpeg], provider)
        self.assertEqual(result["inferenceAttempts"], 4)
        self.assertEqual([row["inferenceAttempts"] for row in result["perAsset"]], [2, 2])
        self.assertEqual(result["counts"]["complete"], 1)
        self.assertEqual(result["counts"]["failed"], 1)
        self.assertEqual(result["perAsset"][1]["errorCode"], "VISION_INVALID_CONTRACT")
        self.assertTrue(all("inferenceSeconds" in row for row in result["perAsset"]))


if __name__ == "__main__":
    unittest.main()
