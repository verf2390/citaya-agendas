"""Analysis persistence invariants against real temporary SQLite/filesystems."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "backend")]
from studio import Actor, Studio
from production import ConfigError


class MediaAnalysisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.fixtures.cleanup)
        cls.jpeg = Path(cls.fixtures.name) / "evidence.jpg"
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=64x96",
            "-frames:v", "1", "-threads", "1", "-update", "1", str(cls.jpeg),
        ], check=True, capture_output=True, timeout=30)
        # Build through the real legacy APIs once, close/checkpoint, then clone a
        # private database per test. No shared live connection, mocks or writes.
        cls.template = Path(cls.fixtures.name) / "template"
        baseline = Studio(cls.template)
        try:
            cls.a = Actor(str(uuid.uuid4()), str(uuid.uuid4()))
            cls.b = Actor(str(uuid.uuid4()), str(uuid.uuid4()))
            config = {"product": "custom-client-video", "brand": {"businessName": "Test"},
                      "content": {"hook": "Test", "cta": "Test"}, "mediaApproved": False}
            cls.pa = baseline.create_project(cls.a, config)
            cls.pa2 = baseline.create_project(cls.a, config)
            cls.pb = baseline.create_project(cls.b, config)
            cls.asset = baseline.upload(cls.a, cls.pa, ROOT / "inputs/test-fixtures/logo.png")
            cls.second = baseline.upload(cls.a, cls.pa, ROOT / "inputs/test-fixtures/business.png")
        finally:
            baseline.close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "private"
        shutil.copytree(self.template, self.root)
        self.s = Studio(self.root)
        self.addCleanup(self.s.close)

    def assert_error(self, code, fn):
        with self.assertRaises(ConfigError) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def approve(self, assets=None):
        return self.s.approve_media_set(self.a, self.pa, assets or [self.asset])

    def enqueue(self, approval=None, key="request", strategy="uniform-v1", extractor="frames-v1"):
        return self.s.enqueue_analysis(self.a, self.pa, approval or self.approve(), key,
                                       strategy_version=strategy, extractor_version=extractor)

    def running(self, assets=None):
        approval = self.approve(assets)
        identifier = self.enqueue(approval)
        job = self.s.claim_analysis("test-worker", lease_seconds=60)
        self.assertEqual(job["id"], identifier)
        return job

    def frame(self, job, asset=None, index=1):
        asset = asset or self.asset
        workspace = self.s.analysis_workspace(job["id"], job["lease_token"])
        directory = workspace / asset
        directory.mkdir(mode=0o700, exist_ok=True)
        shutil.copyfile(self.jpeg, directory / f"frame-{index:04d}.jpg")
        return {"asset_id": asset, "frame_index": index, "timestamp_ms": 0}

    def result(self, asset=None, status="unknown", version="media-evidence-v1"):
        return {"asset_id": asset or self.asset, "status": status, "schema_version": version}

    def finish(self, job, **kwargs):
        return self.s.finish_analysis(job["id"], job["lease_token"], **kwargs)

    def expire(self, job):
        self.s.db.execute("UPDATE video_analysis_jobs SET started_at=?,lease_until=? WHERE id=?",
                          (time.time() - 100, time.time() - 1, job["id"]))

    def rows(self, table):
        return [dict(row) for row in self.s.db.execute("SELECT * FROM " + table)]

    def change_hash(self, asset=None):
        self.s.db.execute("UPDATE video_assets SET sha256=? WHERE id=?", ("0" * 64, asset or self.asset))

    def source(self):
        return self.root / self.s.row("video_assets", self.a, self.asset)["storage_path"]

    def test_approval_exact_snapshot_and_server_hash(self):
        approval = self.s.media_approval(self.a, self.approve([self.asset, self.second]))
        expected = sorted((a, self.s.row("video_assets", self.a, a)["sha256"]) for a in (self.asset, self.second))
        self.assertEqual([(m["asset_id"], m["asset_sha256"]) for m in approval["members"]], expected)
        self.assertEqual(approval["fingerprint"], hashlib.sha256(json.dumps(expected, separators=(",", ":")).encode()).hexdigest())
        self.assertEqual(approval["approved_by"], self.a.user_id)
        self.assertEqual(approval["sealed"], 1)

    def test_fingerprint_deterministic_independent_of_order(self):
        first = self.s.media_approval(self.a, self.approve([self.asset, self.second]))
        second = self.s.media_approval(self.a, self.approve([self.second, self.asset]))
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["fingerprint"], second["fingerprint"])

    def test_approval_rejects_empty_and_duplicates(self):
        for assets in ([], [self.asset, self.asset]):
            self.assert_error("INVALID_MEDIA_SET", lambda: self.s.approve_media_set(self.a, self.pa, assets))

    def test_cross_project_approval_rejected(self):
        foreign = self.s.upload(self.a, self.pa2, ROOT / "inputs/test-fixtures/logo.png")
        self.assert_error("ASSET_PROJECT_MISMATCH", lambda: self.approve([foreign]))

    def test_cross_tenant_approval_rejected(self):
        foreign = self.s.upload(self.b, self.pb, ROOT / "inputs/test-fixtures/logo.png")
        self.assert_error("NOT_FOUND", lambda: self.approve([foreign]))

    def test_approval_revoke_preserves_history_and_is_idempotent(self):
        identifier = self.approve()
        before = self.s.media_approval(self.a, identifier)
        self.s.revoke_media_set(self.a, identifier)
        after = self.s.media_approval(self.a, identifier)
        self.s.revoke_media_set(self.a, identifier)
        self.assertEqual(after, self.s.media_approval(self.a, identifier))
        self.assertEqual(before["members"], after["members"])
        self.assertEqual(before["fingerprint"], after["fingerprint"])
        self.assertIsNotNone(after["revoked_at"])

    def test_revoked_approval_cannot_enqueue(self):
        approval = self.approve()
        self.s.revoke_media_set(self.a, approval)
        self.assert_error("MEDIA_APPROVAL_REVOKED", lambda: self.enqueue(approval))

    def test_new_upload_is_not_in_old_snapshot(self):
        approval = self.approve()
        uploaded = self.s.upload(self.a, self.pa, self.jpeg)
        self.assertNotIn(uploaded, [m["asset_id"] for m in self.s.media_approval(self.a, approval)["members"]])
        self.enqueue(approval)
        job = self.s.claim_analysis("test")
        self.assert_error("ANALYSIS_ASSET_MISMATCH", lambda: self.finish(job, results=[self.result(uploaded)]))

    def test_registered_hash_mismatch_invalidates_approval(self):
        approval = self.approve()
        self.change_hash()
        self.assert_error("ASSET_INTEGRITY", lambda: self.enqueue(approval))

    def test_changed_bytes_without_db_change_invalidate_approval(self):
        approval = self.approve()
        self.source().write_bytes(b"changed without a DB update")
        self.assert_error("ASSET_INTEGRITY", lambda: self.enqueue(approval))

    def test_missing_source_invalidates_approval(self):
        approval = self.approve()
        self.source().unlink()
        self.assert_error("ASSET_INTEGRITY", lambda: self.enqueue(approval))

    def test_missing_asset_row_fails_closed_even_after_database_corruption(self):
        approval = self.approve()
        self.s.db.execute("PRAGMA foreign_keys=OFF")
        self.s.db.execute("DELETE FROM video_assets WHERE id=?", (self.asset,))
        self.s.db.execute("PRAGMA foreign_keys=ON")
        self.assert_error("ASSET_INTEGRITY", lambda: self.enqueue(approval))

    def test_source_symlink_and_outside_storage_reference_rejected(self):
        approval = self.approve()
        source = self.source()
        source.unlink()
        source.symlink_to(ROOT / "inputs/test-fixtures/logo.png")
        self.assert_error("ASSET_INTEGRITY", lambda: self.enqueue(approval))
        self.s.db.execute("UPDATE video_assets SET storage_path=? WHERE id=?", (str(self.jpeg), self.asset))
        self.assert_error("ASSET_INTEGRITY", lambda: self.enqueue(approval))

    def test_enqueue_does_not_extract_or_change_render_state(self):
        project = self.s.project(self.a, self.pa)
        with patch("extract_frames.extract_frames", side_effect=AssertionError("not in enqueue")):
            identifier = self.enqueue()
        self.assertEqual(self.s.analysis_job(self.a, identifier)["status"], "queued")
        self.assertEqual(self.s.project(self.a, self.pa), project)
        self.assertEqual(self.rows("video_jobs"), [])
        self.assertEqual(self.rows("video_analysis_frames"), [])

    def test_enqueue_idempotent(self):
        approval = self.approve()
        self.assertEqual(self.enqueue(approval), self.enqueue(approval))
        self.assertEqual(len(self.rows("video_analysis_jobs")), 1)

    def test_same_key_incompatible_context_rejected(self):
        approval = self.approve()
        self.enqueue(approval)
        self.assert_error("IDEMPOTENCY_CONFLICT", lambda: self.enqueue(approval, strategy="uniform-v2"))
        self.assert_error("IDEMPOTENCY_CONFLICT", lambda: self.enqueue(approval, extractor="frames-v2"))

    def test_active_equivalence_across_keys_and_identical_approvals(self):
        approval = self.approve()
        self.enqueue(approval)
        self.assert_error("ANALYSIS_ALREADY_ACTIVE", lambda: self.enqueue(approval, key="another"))
        self.assert_error("ANALYSIS_ALREADY_ACTIVE", lambda: self.enqueue(self.approve(), key="another"))

    def test_different_versions_are_distinct_jobs(self):
        approval = self.approve()
        self.assertNotEqual(self.enqueue(approval), self.enqueue(approval, key="new", strategy="v2"))

    def test_claim_exclusive(self):
        identifier = self.enqueue()
        first = self.s.claim_analysis("one")
        with self.second_studio() as other:
            self.assertIsNone(other.claim_analysis("two"))
        self.assertEqual(first["id"], identifier)
        self.assertEqual(first["attempt"], 1)

    @contextmanager
    def second_studio(self):
        other = Studio(self.root)
        try:
            yield other
        finally:
            other.close()

    def test_two_simultaneous_workers_only_one_claims(self):
        identifier = self.enqueue()
        gate = threading.Barrier(2)

        def claim(node):
            with self.second_studio() as other:
                gate.wait(timeout=10)
                return other.claim_analysis(node)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(claim, ("one", "two")))
        self.assertEqual([r["id"] for r in results if r], [identifier])

    def test_heartbeat_renews_only_current_token(self):
        job = self.running()
        self.assertFalse(self.s.heartbeat_analysis(job["id"], str(uuid.uuid4())))
        self.assertEqual(self.s.analysis_job(self.a, job["id"])["lease_until"], job["lease_until"])
        self.assertTrue(self.s.heartbeat_analysis(job["id"], job["lease_token"]))
        self.assertGreaterEqual(self.s.analysis_job(self.a, job["id"])["lease_until"], job["lease_until"])

    def test_expired_lease_fails_closed_and_cannot_heartbeat(self):
        job = self.running()
        self.expire(job)
        self.assertFalse(self.s.heartbeat_analysis(job["id"], job["lease_token"]))
        failed = self.s.analysis_job(self.a, job["id"])
        self.assertEqual((failed["status"], failed["error_code"]), ("failed", "LEASE_EXPIRED"))

    def test_claim_reaps_expired_jobs_without_automatic_retry(self):
        job = self.running()
        self.expire(job)
        self.assertIsNone(self.s.claim_analysis("other"))
        self.assertEqual(self.s.analysis_job(self.a, job["id"])["status"], "failed")

    def test_old_worker_cannot_finish_after_retry(self):
        old = self.running()
        self.expire(old)
        self.s.claim_analysis("reap")
        self.assertEqual(self.s.retry_analysis(self.a, old["id"]), old["id"])
        new = self.s.claim_analysis("replacement")
        self.assertNotEqual(new["lease_token"], old["lease_token"])
        self.assertEqual(new["attempt"], 2)
        self.assertEqual(new["idempotency_key"], old["idempotency_key"])
        self.assertFalse(self.finish(old, results=[self.result()]))
        self.assertTrue(self.finish(new, results=[self.result()]))

    def test_cancelled_worker_cannot_publish(self):
        job = self.running()
        frame = self.frame(job)
        self.s.cancel_analysis(self.a, job["id"])
        self.assertFalse(self.finish(job, frames=[frame], results=[self.result()]))
        self.assertEqual(self.rows("video_analysis_frames"), [])
        self.assertEqual(self.rows("video_analysis_results"), [])

    def test_cancel_queued(self):
        identifier = self.enqueue()
        self.s.cancel_analysis(self.a, identifier)
        self.assertIsNone(self.s.claim_analysis("worker"))
        self.assertEqual(self.s.analysis_job(self.a, identifier)["status"], "cancelled")

    def test_retry_only_failed(self):
        identifier = self.enqueue()
        self.assert_error("INVALID_TRANSITION", lambda: self.s.retry_analysis(self.a, identifier))
        job = self.s.claim_analysis("worker")
        self.assert_error("INVALID_TRANSITION", lambda: self.s.retry_analysis(self.a, identifier))
        self.s.cancel_analysis(self.a, identifier)
        self.assert_error("INVALID_TRANSITION", lambda: self.s.retry_analysis(self.a, identifier))
        completed = self.running()
        self.finish(completed)
        self.assert_error("INVALID_TRANSITION", lambda: self.s.retry_analysis(self.a, completed["id"]))

    def test_retry_failed_preserves_identity_and_idempotence(self):
        job = self.running()
        self.assertFalse(self.finish(job, error="EXTRACTION_FAILED"))
        self.s.retry_analysis(self.a, job["id"])
        self.assertEqual(self.enqueue(job["approval_id"]), job["id"])

    def test_retry_cannot_duplicate_active_equivalent(self):
        job = self.running()
        self.finish(job, error="FAILED")
        self.enqueue(job["approval_id"], key="new")
        self.assert_error("ANALYSIS_ALREADY_ACTIVE", lambda: self.s.retry_analysis(self.a, job["id"]))

    def test_actor_apis_reject_cross_tenant(self):
        job = self.running()
        for call in (
            lambda: self.s.media_approval(self.b, job["approval_id"]),
            lambda: self.s.revoke_media_set(self.b, job["approval_id"]),
            lambda: self.s.analysis_job(self.b, job["id"]),
            lambda: self.s.cancel_analysis(self.b, job["id"]),
            lambda: self.s.retry_analysis(self.b, job["id"]),
            lambda: self.s.analysis_frames(self.b, job["id"]),
            lambda: self.s.analysis_results(self.b, job["id"]),
        ):
            self.assert_error("NOT_FOUND", call)
        self.assertFalse(self.s.finish_analysis(job["id"], "not-the-token"))

    def test_enqueue_approval_wrong_project_and_tenant(self):
        approval = self.approve()
        args = dict(strategy_version="v1", extractor_version="v1")
        self.assert_error("APPROVAL_PROJECT_MISMATCH", lambda: self.s.enqueue_analysis(self.a, self.pa2, approval, "k", **args))
        self.assert_error("NOT_FOUND", lambda: self.s.enqueue_analysis(self.b, self.pb, approval, "k", **args))

    def test_revoke_between_enqueue_and_claim(self):
        approval = self.approve()
        identifier = self.enqueue(approval)
        self.s.revoke_media_set(self.a, approval)
        self.assertIsNone(self.s.claim_analysis("worker"))
        self.assertEqual(self.s.analysis_job(self.a, identifier)["error_code"], "MEDIA_APPROVAL_REVOKED")

    def test_revoke_while_running_invalidates_prepare_and_finish(self):
        job = self.running()
        self.assertIsNotNone(self.s.prepare_analysis(job["id"], job["lease_token"]))
        self.s.revoke_media_set(self.a, job["approval_id"])
        self.assertIsNone(self.s.prepare_analysis(job["id"], job["lease_token"]))
        self.assertFalse(self.finish(job, results=[self.result()]))
        self.assert_error("MEDIA_APPROVAL_REVOKED", lambda: self.s.retry_analysis(self.a, job["id"]))

    def test_changed_hash_while_running_blocks_finish(self):
        job = self.running()
        self.change_hash()
        self.assertFalse(self.finish(job, results=[self.result()]))
        self.assertEqual(self.s.analysis_job(self.a, job["id"])["error_code"], "ASSET_INTEGRITY")

    def test_prepare_rechecks_source_bytes(self):
        job = self.running()
        self.source().unlink()
        self.assertIsNone(self.s.prepare_analysis(job["id"], job["lease_token"]))
        self.assertEqual(self.s.analysis_job(self.a, job["id"])["status"], "failed")

    def test_claim_rechecks_registered_hash(self):
        identifier = self.enqueue()
        self.change_hash()
        self.assertIsNone(self.s.claim_analysis("worker"))
        self.assertEqual(self.s.analysis_job(self.a, identifier)["error_code"], "ASSET_INTEGRITY")

    def test_finish_rechecks_source_after_copy_and_cleans_up(self):
        job = self.running()
        frame = self.frame(job)
        real_copy = self.s._copy_analysis_frame

        def change_after_copy(*args):
            result = real_copy(*args)
            self.source().write_bytes(b"changed during publication")
            return result

        with patch.object(self.s, "_copy_analysis_frame", side_effect=change_after_copy):
            self.assertFalse(self.finish(job, frames=[frame], results=[self.result()]))
        self.assertEqual(self.rows("video_analysis_frames"), [])
        self.assertEqual(list((self.root / self.a.tenant_id / self.pa / "analysis").rglob("*.jpg")), [])

    def test_finish_rechecks_lease_after_copy(self):
        job = self.running()
        frame = self.frame(job)
        real_copy = self.s._copy_analysis_frame

        def expire_after_copy(*args):
            result = real_copy(*args)
            self.expire(job)
            return result

        with patch.object(self.s, "_copy_analysis_frame", side_effect=expire_after_copy):
            self.assertFalse(self.finish(job, frames=[frame], results=[self.result()]))
        self.assertEqual(self.rows("video_analysis_frames"), [])

    def test_lease_expiration_during_db_publication_rolls_back_rows_and_files(self):
        job = self.running()
        frame = self.frame(job)
        insert = self.s._insert_analysis_frame

        def expire_after_insert(item):
            insert(item)
            self.expire(job)

        with patch.object(self.s, "_insert_analysis_frame", side_effect=expire_after_insert):
            self.assertFalse(self.finish(job, frames=[frame], results=[self.result()]))
        self.assertEqual(self.rows("video_analysis_frames"), [])
        self.assertEqual(self.rows("video_analysis_results"), [])
        self.assertEqual(self.s.analysis_job(self.a, job["id"])["error_code"], "LEASE_EXPIRED")
        self.assertEqual(list((self.root / self.a.tenant_id / self.pa / "analysis").rglob("*.jpg")), [])

    def test_frame_and_result_publication_end_to_end(self):
        job = self.running()
        frame = self.frame(job)
        self.assertTrue(self.finish(job, frames=[frame], results=[self.result(status="partial")]))
        stored = self.s.analysis_frames(self.a, job["id"])[0]
        self.assertEqual((stored["asset_id"], stored["analysis_job_id"]), (self.asset, job["id"]))
        self.assertEqual(stored["sha256"], hashlib.sha256(self.jpeg.read_bytes()).hexdigest())
        self.assertEqual((stored["width"], stored["height"]), (64, 96))
        expected = Path(self.a.tenant_id) / self.pa / "analysis" / self.asset / job["id"] / "frame-0001.jpg"
        self.assertEqual(stored["storage_path"], str(expected))
        self.assertEqual((self.root / expected).stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / expected.parent).stat().st_mode & 0o777, 0o700)
        result = self.s.analysis_results(self.a, job["id"])[0]
        body = json.loads(result["result_json"])
        self.assertEqual(set(body), {"status", "manifest"})
        self.assertEqual(body["manifest"][0]["id"], stored["id"])
        self.assertEqual(result["provider"], "none")
        self.assertIsNone(result["model"])
        self.assertFalse(self.finish(job, frames=[frame]))

    def test_cross_project_and_unapproved_frames_rejected(self):
        foreign = self.s.upload(self.a, self.pa2, self.jpeg)
        job = self.running()
        for asset in (foreign, self.second):
            frame = {"asset_id": asset, "frame_index": 1, "timestamp_ms": 0}
            self.assert_error("ANALYSIS_ASSET_MISMATCH", lambda: self.finish(job, frames=[frame]))

    def test_caller_paths_hashes_dimensions_rejected(self):
        job = self.running()
        base = {"asset_id": self.asset, "frame_index": 1, "timestamp_ms": 0}
        for key, value in (("path", "/etc/passwd"), ("storage_path", "../../outside"), ("sha256", "0" * 64), ("width", 64)):
            self.assert_error("INVALID_ANALYSIS_FRAME", lambda: self.finish(job, frames=[dict(base, **{key: value})]))

    def test_temporary_symlink_outside_storage_rejected(self):
        job = self.running()
        workspace = self.s.analysis_workspace(job["id"], job["lease_token"])
        (workspace / self.asset).mkdir()
        (workspace / self.asset / "frame-0001.jpg").symlink_to(self.jpeg)
        with self.assertRaises(OSError):
            self.finish(job, frames=[{"asset_id": self.asset, "frame_index": 1, "timestamp_ms": 0}])
        self.assertEqual(self.rows("video_analysis_frames"), [])

    def test_destination_symlink_rejected(self):
        job = self.running()
        frame = self.frame(job)
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        (self.root / self.a.tenant_id / self.pa / "analysis").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            self.finish(job, frames=[frame])
        self.assertEqual(list(outside.iterdir()), [])

    def test_duplicate_frame_indices_rejected(self):
        job = self.running()
        frame = self.frame(job)
        self.assert_error("DUPLICATE_ANALYSIS_FRAME", lambda: self.finish(job, frames=[frame, frame]))

    def test_transaction_failure_cleans_all_copied_frames(self):
        job = self.running()
        frames = [self.frame(job, index=1), self.frame(job, index=2)]
        with patch.object(self.s, "_insert_analysis_frame", side_effect=sqlite3.IntegrityError("injected")):
            with self.assertRaises(sqlite3.IntegrityError):
                self.finish(job, frames=frames, results=[self.result()])
        self.assertEqual(self.rows("video_analysis_frames"), [])
        self.assertEqual(self.rows("video_analysis_results"), [])
        self.assertEqual(list((self.root / self.a.tenant_id / self.pa / "analysis").rglob("*.jpg")), [])
        self.assertEqual(self.s.analysis_job(self.a, job["id"])["status"], "running")

    def test_existing_destination_file_never_overwritten_or_cleaned(self):
        job = self.running()
        frame = self.frame(job)
        directory = self.root / self.a.tenant_id / self.pa / "analysis" / self.asset / job["id"]
        directory.mkdir(parents=True)
        sentinel = directory / "frame-0001.jpg"
        sentinel.write_bytes(b"orphan file from another attempt")
        with self.assertRaises(FileExistsError):
            self.finish(job, frames=[frame])
        self.assertEqual(sentinel.read_bytes(), b"orphan file from another attempt")

    def test_results_scoped_and_require_approved_asset(self):
        job = self.running()
        self.assert_error("ANALYSIS_ASSET_MISMATCH", lambda: self.finish(job, results=[self.result(self.second)]))
        self.finish(job, results=[self.result()])
        self.assert_error("NOT_FOUND", lambda: self.s.analysis_results(self.b, job["id"]))

    def test_result_schema_required_and_status_enum(self):
        job = self.running()
        for result in ({"asset_id": self.asset, "status": "unknown"}, self.result(version=""), self.result(status="invented")):
            self.assert_error("INVALID_ANALYSIS_RESULT", lambda: self.finish(job, results=[result]))

    def test_unknown_partial_complete_supported_without_semantics(self):
        for status in ("unknown", "partial", "complete"):
            job = self.running()
            self.assertTrue(self.finish(job, results=[self.result(status=status)]))
            result = self.s.analysis_results(self.a, job["id"])[0]
            self.assertEqual(json.loads(result["result_json"]), {"status": status, "manifest": []})

    def test_caller_cannot_supply_semantics_or_correction_identity(self):
        job = self.running()
        for extra in ({"labels": ["invented"]}, {"corrected_by": self.a.user_id}, {"provider": "cloud"}):
            self.assert_error("INVALID_ANALYSIS_RESULT", lambda: self.finish(job, results=[dict(self.result(), **extra)]))

    def test_result_schema_versions_coexist(self):
        job = self.running()
        self.finish(job, results=[self.result(version="v1"), self.result(version="v2")])
        self.assertEqual({r["schema_version"] for r in self.s.analysis_results(self.a, job["id"])}, {"v1", "v2"})

    def test_completed_results_unusable_after_revocation(self):
        job = self.running()
        self.finish(job, frames=[self.frame(job)], results=[self.result()])
        self.s.revoke_media_set(self.a, job["approval_id"])
        self.assert_error("MEDIA_APPROVAL_REVOKED", lambda: self.s.analysis_results(self.a, job["id"]))
        self.assert_error("MEDIA_APPROVAL_REVOKED", lambda: self.s.analysis_frames(self.a, job["id"]))
        self.assertEqual(len(self.rows("video_analysis_results")), 1)

    def test_completed_results_unusable_after_source_change(self):
        job = self.running()
        self.finish(job, results=[self.result()])
        self.change_hash()
        self.assert_error("ASSET_INTEGRITY", lambda: self.s.analysis_results(self.a, job["id"]))

    def test_unfinished_analysis_not_readable(self):
        job = self.running()
        self.assert_error("ANALYSIS_NOT_COMPLETED", lambda: self.s.analysis_results(self.a, job["id"]))
        self.assert_error("ANALYSIS_NOT_COMPLETED", lambda: self.s.analysis_frames(self.a, job["id"]))

    def insert_row(self, table, row):
        self.s.db.execute("INSERT INTO " + table + "(" + ",".join(row) + ") VALUES(" + ",".join("?" for _ in row) + ")", tuple(row.values()))

    def test_foreign_keys_and_idempotent_schema_installation(self):
        self.assertEqual(self.s.db.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        before = self.s.db.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall()
        self.s.db.executescript((ROOT / "backend/schema.sql").read_text())
        self.assertEqual(before, self.s.db.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall())
        self.assertEqual(self.s.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        for name in ("media_approvals_project", "analysis_jobs_claim", "analysis_jobs_project", "analysis_frames_job", "analysis_results_job", "analysis_active_equivalent"):
            self.assertTrue(self.s.db.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (name,)).fetchone())

    def test_db_approval_members_are_immutable(self):
        approval = self.approve()
        for statement in (
            "UPDATE media_approval_members SET asset_sha256='" + "0" * 64 + "' WHERE approval_id=?",
            "DELETE FROM media_approval_members WHERE approval_id=?",
            "UPDATE media_approval_sets SET fingerprint='" + "0" * 64 + "' WHERE id=?",
            "UPDATE media_approval_sets SET sealed=0 WHERE id=?",
            "DELETE FROM media_approval_sets WHERE id=?",
        ):
            with self.assertRaises(sqlite3.IntegrityError):
                self.s.db.execute(statement, (approval,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.db.execute("INSERT INTO media_approval_members VALUES(?,?,?,?,?)",
                              (approval, self.a.tenant_id, self.pa, self.second, self.s.row("video_assets", self.a, self.second)["sha256"]))

    def test_db_cannot_unrevoke_approval(self):
        approval = self.approve()
        self.s.revoke_media_set(self.a, approval)
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.db.execute("UPDATE media_approval_sets SET revoked_at=NULL WHERE id=?", (approval,))

    def test_db_active_equivalent_unique_index(self):
        identifier = self.enqueue()
        row = self.s.analysis_job(self.a, identifier)
        row.update(id=str(uuid.uuid4()), idempotency_key="different")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_row("video_analysis_jobs", row)

    def test_db_job_context_and_transition_protected(self):
        identifier = self.enqueue()
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.db.execute("UPDATE video_analysis_jobs SET strategy_version='changed' WHERE id=?", (identifier,))
        self.s.cancel_analysis(self.a, identifier)
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.db.execute("UPDATE video_analysis_jobs SET status='queued',finished_at=NULL WHERE id=?", (identifier,))

    def test_db_cross_tenant_and_project_job_fks(self):
        identifier = self.enqueue()
        row = self.s.analysis_job(self.a, identifier)
        for tenant, project in ((self.b.tenant_id, self.pb), (self.a.tenant_id, self.pa2)):
            mutated = dict(row, id=str(uuid.uuid4()), tenant_id=tenant, project_id=project, idempotency_key="foreign")
            with self.assertRaises(sqlite3.IntegrityError):
                self.insert_row("video_analysis_jobs", mutated)

    def test_db_frame_constraints_membership_path_duplicate(self):
        job = self.running()
        self.finish(job, frames=[self.frame(job)])
        original = self.rows("video_analysis_frames")[0]
        # Use a new running job so the running guard is not what rejects the row.
        other = self.running()
        row = dict(original, id=str(uuid.uuid4()), analysis_job_id=other["id"], approval_id=other["approval_id"])
        row["storage_path"] = str(Path(self.a.tenant_id) / self.pa / "analysis" / self.asset / other["id"] / "frame-0001.jpg")
        for change in ({"storage_path": "/tmp/outside.jpg"}, {"asset_id": self.second}, {"project_id": self.pa2}, {"tenant_id": self.b.tenant_id}, {"frame_index": 0}, {"sha256": "caller"}):
            candidate = dict(row, **change)
            if "asset_id" in change:
                candidate["storage_path"] = str(Path(self.a.tenant_id) / self.pa / "analysis" / self.second / other["id"] / "frame-0001.jpg")
            with self.assertRaises(sqlite3.IntegrityError):
                self.insert_row("video_analysis_frames", candidate)
        self.insert_row("video_analysis_frames", row)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_row("video_analysis_frames", dict(row, id=str(uuid.uuid4())))

    def test_db_results_cannot_reference_asset_outside_job(self):
        completed = self.running()
        self.finish(completed, results=[self.result()])
        original = self.rows("video_analysis_results")[0]
        job = self.running()
        row = dict(original, id=str(uuid.uuid4()), analysis_job_id=job["id"], approval_id=job["approval_id"])
        for change in ({"asset_id": self.second}, {"project_id": self.pa2}, {"schema_version": ""}, {"status": "invalid"}, {"result_json": '{}'}, {"result_json": 'invalid'}):
            with self.assertRaises(sqlite3.IntegrityError):
                self.insert_row("video_analysis_results", dict(row, **change))

    def correction(self, original):
        now = time.time()
        return dict(original, id=str(uuid.uuid4()), revision=original["revision"] + 1,
                    supersedes_result_id=original["id"], original_result_json=original["original_result_json"] or original["result_json"],
                    corrected_by=self.a.user_id, corrected_at=now, created_at=now,
                    result_json=json.dumps({"status": "partial", "manifest": []}), status="partial")

    def test_db_future_corrections_preserve_original_across_versions(self):
        job = self.running()
        self.finish(job, results=[self.result()])
        original = self.rows("video_analysis_results")[0]
        corrected = self.correction(original)
        self.insert_row("video_analysis_results", corrected)
        second = self.correction(corrected)
        self.insert_row("video_analysis_results", second)
        results = self.s.analysis_results(self.a, job["id"])
        self.assertEqual(len(results), 3)
        self.assertEqual(second["original_result_json"], original["result_json"])
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.db.execute("UPDATE video_analysis_results SET result_json=? WHERE id=?", (corrected["result_json"], original["id"]))
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.db.execute("DELETE FROM video_analysis_results WHERE id=?", (original["id"],))

    def test_db_correction_author_date_original_invariants(self):
        job = self.running()
        self.finish(job, results=[self.result()])
        original = self.rows("video_analysis_results")[0]
        corrected = self.correction(original)
        for change in ({"corrected_by": None}, {"corrected_at": None}, {"original_result_json": None},
                       {"supersedes_result_id": None}, {"original_result_json": '{}'},
                       {"corrected_at": original["created_at"] - 1}, {"revision": 3}):
            with self.assertRaises(sqlite3.IntegrityError):
                self.insert_row("video_analysis_results", dict(corrected, **change))

    def semantic_result(self, frames, status="complete"):
        from test_vision_provider import observation
        from vision_provider import SCHEMA_VERSION, MODEL, PROVIDER
        return {"asset_id": self.asset, "schema_version": SCHEMA_VERSION, "status": status,
                "provider": PROVIDER, "model": MODEL, "semantic": observation(),
                "evidence_sha256": [hashlib.sha256(self.jpeg.read_bytes()).hexdigest() for _ in frames]}

    def test_semantic_evidence_uses_persisted_frame_identity(self):
        job = self.running()
        frame = self.frame(job)
        result = self.semantic_result([frame])
        self.finish(job, frames=[frame], results=[result])
        body = json.loads(self.rows("video_analysis_results")[0]["result_json"])
        stored = self.rows("video_analysis_frames")[0]
        self.assertEqual(body["evidence"], [{"frameId": stored["id"], "timestampMs": stored["timestamp_ms"], "supports": ["tool_work"]}])

    def test_semantic_changed_evidence_bytes_roll_back_publication(self):
        job = self.running()
        frame = self.frame(job)
        result = self.semantic_result([frame])
        result["evidence_sha256"] = ["0" * 64]
        self.assert_error("ANALYSIS_EVIDENCE_MISMATCH", lambda: self.finish(job, frames=[frame], results=[result]))
        self.assertEqual(self.rows("video_analysis_frames"), [])
        self.assertEqual(self.rows("video_analysis_results"), [])
        self.assertFalse(list(self.root.glob("**/analysis/*/*/frame-*.jpg")))

    def test_semantic_cannot_change_frame_metadata(self):
        job = self.running()
        frame = self.frame(job)
        for key in ("timestampMs", "frameId", "sha256", "path"):
            result = self.semantic_result([frame])
            result["semantic"]["evidence"][0][key] = "invented"
            self.assert_error("INVALID_ANALYSIS_RESULT", lambda: self.finish(job, frames=[frame], results=[result]))

    def test_semantic_must_have_matching_frames_and_status(self):
        job = self.running()
        result = self.semantic_result([{}])
        self.assert_error("ANALYSIS_EVIDENCE_MISMATCH", lambda: self.finish(job, results=[result]))
        frame = self.frame(job)
        result["status"] = "unknown"
        self.assert_error("INVALID_ANALYSIS_RESULT", lambda: self.finish(job, frames=[frame], results=[result]))

    def test_semantic_correction_preserves_original(self):
        job = self.running()
        frame = self.frame(job)
        self.finish(job, frames=[frame], results=[self.semantic_result([frame])])
        original = self.rows("video_analysis_results")[0]
        corrected = self.correction(original)
        body = json.loads(original["result_json"])
        body["semantic"]["summary"] = "Observación corregida por una persona."
        body["status"] = corrected["status"]
        corrected["result_json"] = json.dumps(body)
        self.insert_row("video_analysis_results", corrected)
        rows = self.rows("video_analysis_results")
        self.assertEqual(rows[1]["original_result_json"], original["result_json"])
        self.assertEqual(self.s.visual_inventory(self.a, self.pa)[self.asset]["summary"], body["semantic"]["summary"])


if __name__ == "__main__":
    unittest.main()
