"""UI orchestration over the existing approval, analysis queue and fenced worker."""
import json
import logging
import os
import select
import subprocess
import sys
from pathlib import Path

from editorial_contract import selected_visual_ids
from production import fail
from analysis_worker import STRATEGY_VERSION, EXTRACTOR_VERSION, WORKER_IDLE_SECONDS, DEFAULT_NODE, worker_lock


STARTUP_OBSERVATION_SECONDS = WORKER_IDLE_SECONDS
logger = logging.getLogger(__name__)


def visual_inputs(studio, actor, project_id, config):
    ids = selected_visual_ids(config)
    for asset_id in ids:
        row = studio.row('video_assets', actor, asset_id)
        if row['project_id'] != project_id or row['asset_type'] not in ('image', 'video'):
            fail('DIRECTOR_MEDIA_INVALID', 'Choose images/videos belonging to this project.')
    return ids


def launch_analysis(studio, job_id):
    # Reserve the EXISTING global worker lock before spawning. The child inherits
    # the same open file description, so releasing our FD cannot create a gap.
    job = dict(studio.db.execute('SELECT * FROM video_analysis_jobs WHERE id=?', (job_id,)).fetchone())
    if job['status'] != 'queued':
        return
    try:
        with worker_lock(studio.root) as lock_fd:
            if not studio.reserve_analysis_launch(job, DEFAULT_NODE):
                current = studio.db.execute('SELECT error_code FROM video_analysis_jobs WHERE id=?', (job_id,)).fetchone()
                if current['error_code'] == 'ANALYSIS_START_FAILED':
                    logger.warning('Visual analysis wake lost its lock before claim.')
                return
            try:
                process = subprocess.Popen(
                    [sys.executable, str(Path(__file__).with_name('analysis_worker.py')),
                     '--storage', str(studio.root), '--once', '--job-id', job_id,
                     '--lock-fd', str(lock_fd), '--report-startup'],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    start_new_session=True, close_fds=True, pass_fds=(lock_fd,))
            except OSError:
                if studio.fail_analysis_start(job):
                    logger.warning('Visual analysis process could not start.')
                return
            try:
                readable, _, _ = select.select([process.stdout], [], [], STARTUP_OBSERVATION_SECONDS)
                if readable:
                    event = os.read(process.stdout.fileno(), 32).strip()
                    if event not in (b'claimed', b'busy'):
                        # EOF/nonzero exit/unclaimed: CAS refuses to invalidate a
                        # running claim, completion, cancellation or newer retry.
                        if studio.fail_analysis_start(job):
                            exit_code = process.poll()
                            if exit_code is None:
                                try:
                                    exit_code = process.wait(timeout=STARTUP_OBSERVATION_SECONDS)
                                except subprocess.TimeoutExpired:
                                    pass
                            logger.warning('Visual analysis exited before claim (exit=%s).', exit_code)
            finally:
                process.stdout.close()
    except BlockingIOError:
        return  # Existing daemon/another wake owns the lock; keep waiting.
    except OSError:
        if studio.fail_analysis_start(job):
            logger.warning('Visual analysis process could not start.')


def analysis_error(job):
    if job['status'] not in ('failed', 'cancelled'):
        return
    code = job['error_code']
    messages = {
        'ANALYSIS_START_FAILED': 'No se pudo iniciar el análisis visual. Reintenta Dirigir con IA.',
        'ANALYSIS_QUEUE_TIMEOUT': 'El análisis visual no pudo obtener turno. Reintenta Dirigir con IA.',
        'LEASE_EXPIRED': 'El análisis visual perdió su conexión con el worker. Reintenta Dirigir con IA.',
    }
    fail(code if code in messages else 'VISUAL_ANALYSIS_FAILED',
         messages.get(code, 'No se pudieron analizar los medios. Reintenta Dirigir con IA.'))


def prepare_direction(studio, actor, project_id, *, approved_ids=None, analysis_consent=False):
    config = json.loads(studio.project(actor, project_id)['config_json'])
    required = visual_inputs(studio, actor, project_id, config)
    inventory = studio.visual_inventory(actor, project_id)
    missing = [a for a in required if a not in inventory]
    if not missing:
        if any(inventory[a]['status'] not in ('partial', 'complete') for a in required):
            fail('VISUAL_ANALYSIS_REQUIRED', 'Visual evidence is insufficient. Review the supplied material.')
        return {'status': 'ready', 'visualAssetCount': len(required)}
    # Rights review is distinct from consent to local visual analysis. The UI
    # submits the exact displayed set; a changed set requires another consent.
    if analysis_consent is not True or not isinstance(approved_ids, list) or sorted(approved_ids) != required:
        fail('ANALYSIS_APPROVAL_REQUIRED', 'Approve the selected images/videos for local analysis.')
    approval_id = studio.approve_media_set(actor, project_id, missing)
    approval = studio.media_approval(actor, approval_id)
    active = studio._active_equivalent(dict(tenant_id=actor.tenant_id, project_id=project_id,
                                           approval_fingerprint=approval['fingerprint'],
                                           strategy_version=STRATEGY_VERSION, extractor_version=EXTRACTOR_VERSION))
    if active:
        job_id = active['id']
    else:
        # An explicit new click with consent may retry the same failed job/key,
        # only while its original authorization remains current and unrevoked.
        failed = studio.db.execute(
            "SELECT j.id FROM video_analysis_jobs j JOIN media_approval_sets a ON a.id=j.approval_id "
            "WHERE j.tenant_id=? AND j.project_id=? AND j.approval_fingerprint=? "
            "AND j.strategy_version=? AND j.extractor_version=? AND j.idempotency_key='director' "
            "AND j.status='failed' AND a.revoked_at IS NULL ORDER BY j.queued_at DESC,j.id LIMIT 1",
            (actor.tenant_id, project_id, approval['fingerprint'], STRATEGY_VERSION, EXTRACTOR_VERSION)).fetchone()
        job_id = studio.retry_analysis(actor, failed['id']) if failed else studio.enqueue_analysis(
            actor, project_id, approval_id, 'director', strategy_version=STRATEGY_VERSION,
            extractor_version=EXTRACTOR_VERSION)
    launch_analysis(studio, job_id)
    return {'status': 'analyzing', 'analysisJobId': job_id}


def direction_analysis_status(studio, actor, project_id, job_id):
    job = studio.analysis_progress(actor, project_id, job_id)
    analysis_error(job)
    if job['status'] in ('queued', 'running'):
        if job['status'] == 'queued':
            launch_analysis(studio, job_id)
            job = studio.analysis_progress(actor, project_id, job_id)
            analysis_error(job)
        if job['status'] in ('queued', 'running'):
            return {'status': 'analyzing', 'analysisJobId': job_id, 'analysisState': job['status']}
    return prepare_direction(studio, actor, project_id)
