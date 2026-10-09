"""UI orchestration over the existing approval, analysis queue and fenced worker."""
import json
import subprocess
import sys
import time
from pathlib import Path

from editorial_contract import selected_visual_ids
from production import fail
from analysis_worker import STRATEGY_VERSION, EXTRACTOR_VERSION


def visual_inputs(studio, actor, project_id, config):
    ids = selected_visual_ids(config)
    for asset_id in ids:
        row = studio.row('video_assets', actor, asset_id)
        if row['project_id'] != project_id or row['asset_type'] not in ('image', 'video'):
            fail('DIRECTOR_MEDIA_INVALID', 'Choose images/videos belonging to this project.')
    return ids


def launch_analysis(studio, job_id):
    # A request wakes the existing worker for this specific job only. Global
    # worker_lock + atomic claim prevent concurrent inference with a daemon.
    subprocess.Popen([sys.executable, str(Path(__file__).with_name('analysis_worker.py')),
                      '--storage', str(studio.root), '--once', '--job-id', job_id],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True, close_fds=True)


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
    job_id = active['id'] if active else studio.enqueue_analysis(
        actor, project_id, approval_id, 'director', strategy_version=STRATEGY_VERSION,
        extractor_version=EXTRACTOR_VERSION)
    launch_analysis(studio, job_id)
    return {'status': 'analyzing', 'analysisJobId': job_id}


def direction_analysis_status(studio, actor, project_id, job_id):
    job = studio.analysis_job(actor, job_id)
    if job['project_id'] != project_id:
        fail('NOT_FOUND', 'Analysis not found.')
    if job['status'] in ('failed', 'cancelled'):
        fail('VISUAL_ANALYSIS_FAILED', 'Local visual analysis failed. Retry explicitly.')
    if job['status'] in ('queued', 'running'):
        # A queued wake may have lost the global worker lock; polling retries it.
        # An expired lease is fenced by the existing claim path, never reused.
        if job['status'] == 'queued' or job['lease_until'] <= time.time():
            launch_analysis(studio, job_id)
        return {'status': 'analyzing', 'analysisJobId': job_id}
    return prepare_direction(studio, actor, project_id)
