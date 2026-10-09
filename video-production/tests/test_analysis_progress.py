"""Offline startup/polling regressions, real SQLite/locks, controlled time."""
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'scripts')]
import analysis_worker as worker
import director_analysis as flow
from production import ConfigError
from studio import Studio
from test_analysis_worker import FakeProvider
import test_media_analysis as persistence


class AnalysisProgressTests(unittest.TestCase):
    setUpClass = classmethod(persistence.MediaAnalysisTests.setUpClass.__func__)
    setUp = persistence.MediaAnalysisTests.setUp
    approve = persistence.MediaAnalysisTests.approve
    change_hash = persistence.MediaAnalysisTests.change_hash

    def enqueue(self):
        config = json.loads(self.s.project(self.a, self.pa)['config_json'])
        config.update(media={'images': ['asset:' + self.asset]}, mediaPolicy={'mediaFirst': True})
        self.s.update_project(self.a, self.pa, config)
        self.approval = self.approve()
        self.job = self.s.enqueue_analysis(self.a, self.pa, self.approval, 'director',
                                          strategy_version=worker.STRATEGY_VERSION,
                                          extractor_version=worker.EXTRACTOR_VERSION)
        return self.s.analysis_job(self.a, self.job)

    def status(self):
        return flow.direction_analysis_status(self.s, self.a, self.pa, self.job)

    def assert_failure(self, code):
        with self.assertRaises(ConfigError) as caught:
            self.status()
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn(str(self.root), str(caught.exception))

    def test_queued_claim_running_then_complete(self):
        self.enqueue()
        states = []
        with patch.object(flow, 'launch_analysis') as launch:
            worker.run_one(self.s, 'fake', FakeProvider(), job_id=self.job,
                           on_claim=lambda: states.append(self.status()))
            self.assertEqual(states[0]['analysisState'], 'running')
            self.assertEqual(self.status(), {'status': 'ready', 'visualAssetCount': 1})
            launch.assert_not_called()

    def test_real_subprocess_exit_before_claim_is_terminal_and_logged(self):
        self.enqueue()
        with patch.object(flow.sys, 'executable', '/bin/false'), self.assertLogs(flow.logger, 'WARNING') as logs:
            flow.launch_analysis(self.s, self.job)
        self.assertIn('exit=1', ' '.join(logs.output))
        self.assert_failure('ANALYSIS_START_FAILED')
        job = self.s.analysis_job(self.a, self.job)
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(job['attempt'], 0)

    def test_spawn_failure_has_safe_diagnostic(self):
        self.enqueue()
        with patch.object(flow.subprocess, 'Popen', side_effect=PermissionError('secret/private/path')), \
                self.assertLogs(flow.logger, 'WARNING') as logs:
            flow.launch_analysis(self.s, self.job)
        self.assertNotIn('secret', ' '.join(logs.output))
        self.assert_failure('ANALYSIS_START_FAILED')

    def test_queue_deadline_uses_existing_initial_lease_and_does_not_spawn(self):
        job = self.enqueue()
        with patch('media_analysis.time.time', return_value=job['queued_at'] + job['lease_seconds']), \
                patch.object(flow, 'launch_analysis') as launch:
            self.assert_failure('ANALYSIS_QUEUE_TIMEOUT')
            launch.assert_not_called()
        self.assertEqual(self.s.analysis_job(self.a, self.job)['error_code'], 'ANALYSIS_QUEUE_TIMEOUT')

    def test_long_running_renewed_lease_is_not_a_queue_timeout(self):
        initial = self.enqueue()
        claimed = self.s.claim_analysis('slow', lease_seconds=600, job_id=self.job)
        with patch.object(flow, 'launch_analysis') as launch:
            # Ten real heartbeat transitions with a fake clock, beyond 1800s.
            for step in range(1, 11):
                now = claimed['started_at'] + 200 * step
                with patch('media_analysis.time.time', return_value=now):
                    self.assertTrue(self.s.heartbeat_analysis(self.job, claimed['lease_token']))
                    self.assertEqual(self.status()['analysisState'], 'running')
            launch.assert_not_called()
        self.assertGreater(now, initial['queued_at'] + initial['lease_seconds'])
        self.assertEqual(self.s.analysis_job(self.a, self.job)['attempt'], 1)

    def test_expired_running_lease_uses_existing_fencing_and_explicit_retry(self):
        self.enqueue()
        claimed = self.s.claim_analysis('abandoned', lease_seconds=600, job_id=self.job)
        with patch('media_analysis.time.time', return_value=claimed['lease_until']), \
                patch.object(flow, 'launch_analysis') as launch:
            self.assert_failure('LEASE_EXPIRED')
            launch.assert_not_called()
        self.s.retry_analysis(self.a, self.job)
        new = self.s.claim_analysis('retry', job_id=self.job)
        self.assertNotEqual(new['lease_token'], claimed['lease_token'])
        self.assertFalse(self.s.heartbeat_analysis(self.job, claimed['lease_token']))
        self.assertFalse(self.s.finish_analysis(self.job, claimed['lease_token'], error='OLD_WORKER'))

    def test_failed_job_stops_polling_without_leaking_worker_exception(self):
        self.enqueue()
        worker.run_one(self.s, 'fake', FakeProvider(callback=lambda: (_ for _ in ()).throw(
            RuntimeError('secret narration /private/file'))), job_id=self.job)
        with patch.object(flow, 'launch_analysis') as launch:
            self.assert_failure('VISUAL_ANALYSIS_FAILED')
            launch.assert_not_called()

    def test_refresh_and_polls_wait_on_existing_global_lock_without_spawning(self):
        self.enqueue()
        with worker.worker_lock(self.root), patch.object(flow.subprocess, 'Popen') as spawn:
            for _ in range(5):
                self.assertEqual(self.status()['analysisState'], 'queued')
            spawn.assert_not_called()
        self.assertEqual(self.s.db.execute('SELECT count(*) FROM video_analysis_jobs').fetchone()[0], 1)

    def test_concurrent_polls_create_one_launch_and_slow_start_is_not_failed(self):
        self.enqueue()
        child_fds, barrier = [], threading.Barrier(2)

        class Child:
            stdout = None

            def __init__(self, args, **kwargs):
                child_fds.append(os.dup(kwargs['pass_fds'][0]))
                self.stdout = io.BytesIO()

        def poll():
            local = Studio(self.root)
            try:
                barrier.wait(timeout=5)
                return flow.direction_analysis_status(local, self.a, self.pa, self.job)
            finally:
                local.close()

        try:
            with patch.object(flow.subprocess, 'Popen', side_effect=Child) as spawn, \
                    patch.object(flow.select, 'select', return_value=([], [], [])), \
                    ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: poll(), range(2)))
                self.assertTrue(all(r['analysisState'] == 'queued' for r in results))
                self.assertEqual(spawn.call_count, 1)
                self.assertEqual(self.status()['analysisState'], 'queued')
                self.assertEqual(spawn.call_count, 1)
        finally:
            for fd in child_fds:
                os.close(fd)

    def test_late_start_failure_cannot_override_claim_or_new_retry_generation(self):
        first = self.enqueue()
        claimed = self.s.claim_analysis('valid', job_id=self.job)
        self.assertFalse(self.s.fail_analysis_start(first))
        self.assertEqual(self.s.analysis_job(self.a, self.job)['status'], 'running')
        self.s.finish_analysis(self.job, claimed['lease_token'], error='TEST_FAILURE')
        with patch('media_analysis.time.time', return_value=first['queued_at'] + 1):
            self.s.retry_analysis(self.a, self.job)
        self.assertFalse(self.s.fail_analysis_start(first))
        self.assertEqual(self.s.analysis_job(self.a, self.job)['status'], 'queued')

    def test_retry_generation_is_fenced_even_with_a_frozen_clock(self):
        first = self.enqueue()
        self.s.fail_analysis_start(first)
        with patch('media_analysis.time.time', return_value=first['queued_at']):
            self.s.retry_analysis(self.a, self.job)
        self.assertGreater(self.s.analysis_job(self.a, self.job)['queued_at'], first['queued_at'])
        self.assertFalse(self.s.fail_analysis_start(first))
        self.assertEqual(self.s.analysis_job(self.a, self.job)['status'], 'queued')

    def test_exit_after_observation_before_claim_is_detected_without_relaunch(self):
        self.enqueue()
        child_fds = []

        def slow_child(args, **kwargs):
            child_fds.append(os.dup(kwargs['pass_fds'][0]))
            class Child:
                stdout = io.BytesIO()
            return Child()

        try:
            with patch.object(flow.subprocess, 'Popen', side_effect=slow_child) as spawn, \
                    patch.object(flow.select, 'select', return_value=([], [], [])):
                flow.launch_analysis(self.s, self.job)
                self.assertEqual(self.status()['analysisState'], 'queued')
                os.close(child_fds.pop())  # Abrupt exit, outside worker.main's error handler.
                with self.assertLogs(flow.logger, 'WARNING'):
                    self.assert_failure('ANALYSIS_START_FAILED')
                self.assertEqual(spawn.call_count, 1)
                self.assert_failure('ANALYSIS_START_FAILED')
                self.assertEqual(spawn.call_count, 1)
        finally:
            for fd in child_fds:
                os.close(fd)

    def test_explicit_panel_retry_preserves_job_approval_key_and_resets_queue_time(self):
        first = self.enqueue()
        with worker.worker_lock(self.root):
            self.assertTrue(self.s.reserve_analysis_launch(first, worker.DEFAULT_NODE))
        self.s.fail_analysis_start(first)
        with patch('media_analysis.time.time', return_value=first['queued_at'] + 1), \
                patch.object(flow, 'launch_analysis'):
            result = flow.prepare_direction(self.s, self.a, self.pa, approved_ids=[self.asset], analysis_consent=True)
        updated = self.s.analysis_job(self.a, self.job)
        self.assertEqual(result['analysisJobId'], self.job)
        self.assertEqual(updated['approval_id'], first['approval_id'])
        self.assertEqual(updated['idempotency_key'], first['idempotency_key'])
        self.assertGreater(updated['queued_at'], first['queued_at'])
        self.assertIsNone(updated['worker_node'])
        self.assertEqual(self.s.db.execute('SELECT count(*) FROM video_analysis_jobs').fetchone()[0], 1)

    def test_revocation_and_stale_hash_during_wait_fail_before_launch(self):
        self.enqueue()
        self.change_hash()
        with patch.object(flow, 'launch_analysis') as launch:
            self.assert_failure('VISUAL_ANALYSIS_FAILED')
            launch.assert_not_called()
        self.assertEqual(self.s.analysis_job(self.a, self.job)['error_code'], 'ASSET_INTEGRITY')
        with self.assertRaises(ConfigError):
            self.s.retry_analysis(self.a, self.job)

    def test_revoked_approval_cannot_be_retried(self):
        self.enqueue()
        self.s.revoke_media_set(self.a, self.approval)
        self.assert_failure('VISUAL_ANALYSIS_FAILED')
        with self.assertRaises(ConfigError) as caught:
            self.s.retry_analysis(self.a, self.job)
        self.assertEqual(caught.exception.code, 'MEDIA_APPROVAL_REVOKED')

    def test_progress_is_project_and_tenant_scoped_before_any_mutation(self):
        self.enqueue()
        for actor, project in ((self.b, self.pa), (self.a, self.pa2)):
            with self.assertRaises(ConfigError) as caught:
                flow.direction_analysis_status(self.s, actor, project, self.job)
            self.assertEqual(caught.exception.code, 'NOT_FOUND')
        self.assertEqual(self.s.analysis_job(self.a, self.job)['status'], 'queued')

    def test_worker_startup_exception_after_observation_window_is_persisted(self):
        self.enqueue()
        args = ['worker', '--storage', str(self.root), '--once', '--job-id', self.job]
        with patch.object(sys, 'argv', args), \
                patch.object(worker, 'VisionProvider', side_effect=RuntimeError('private secret')), \
                self.assertLogs('analysis_worker', 'ERROR') as logs, self.assertRaises(SystemExit) as caught:
            worker.main()
        self.assertEqual(caught.exception.code, 1)
        self.assertNotIn('private', ' '.join(logs.output))
        self.assert_failure('ANALYSIS_START_FAILED')

    def test_real_lock_handoff_and_claim_ack_with_offline_provider(self):
        self.enqueue()
        real_popen, children = subprocess.Popen, []
        script = """
import os, sys
sys.path[:0] = sys.argv[4:]
from studio import Studio
from analysis_worker import worker_lock, run_one
from test_analysis_worker import FakeProvider
studio = Studio(sys.argv[1])
try:
    with worker_lock(studio.root, int(sys.argv[3])):
        run_one(studio, 'offline-child', FakeProvider(), job_id=sys.argv[2],
                on_claim=lambda: os.write(1, b'claimed\\n'))
finally:
    studio.close()
"""

        def spawn(args, **kwargs):
            child = real_popen([sys.executable, '-c', script, str(self.root), self.job,
                                str(kwargs['pass_fds'][0]), str(ROOT / 'backend'),
                                str(ROOT / 'scripts'), str(ROOT / 'tests')], **kwargs)
            children.append(child)
            return child

        try:
            with patch.object(flow.subprocess, 'Popen', side_effect=spawn) as launch:
                flow.launch_analysis(self.s, self.job)
                self.assertIn(self.status()['status'], ('analyzing', 'ready'))
                self.assertEqual(launch.call_count, 1)
            self.assertEqual(children[0].wait(timeout=20), 0)
            self.assertEqual(self.status()['status'], 'ready')
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
