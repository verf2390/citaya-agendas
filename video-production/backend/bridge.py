#!/usr/bin/env python3
"""Private JSON bridge between Citaya Next.js and Video Studio.

This process is spawned server-side only. It has no HTTP listener and never
authenticates callers itself; tenant/user identity must come from Citaya's
trusted admin boundary.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from studio import Actor, Studio, uid
from tenant_brief import generate_tenant_config

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STORAGE = ROOT / "storage" / "private"
STAGING_ROOT = (ROOT / "storage" / "staging").resolve()


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")


def safe_json(value, fallback=None):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def safe_project_detail(studio, actor, project_id):
    project = studio.project(actor, project_id)
    assets = [
        {
            "id": row["id"],
            "assetType": row["asset_type"],
            "mimeType": row["mime_type"],
            "sizeBytes": row["size_bytes"],
            "durationMs": row["duration_ms"],
            "width": row["width"],
            "height": row["height"],
            "createdAt": row["created_at"],
        }
        for row in studio.db.execute(
            "SELECT id,asset_type,mime_type,size_bytes,duration_ms,width,height,created_at "
            "FROM video_assets WHERE tenant_id=? AND project_id=? ORDER BY created_at",
            (actor.tenant_id, project_id),
        )
    ]
    jobs = [
        {
            "id": row["id"],
            "revision": row["revision"],
            "status": row["status"],
            "mode": row["mode"],
            "queuedAt": row["queued_at"],
            "startedAt": row["started_at"],
            "finishedAt": row["finished_at"],
            "errorCode": row["error_code"],
            "renderSeconds": row["render_seconds"],
            "attempt": row["attempt"],
        }
        for row in studio.db.execute(
            "SELECT id,revision,status,mode,queued_at,started_at,finished_at,error_code,"
            "render_seconds,attempt FROM video_jobs "
            "WHERE tenant_id=? AND project_id=? ORDER BY queued_at DESC",
            (actor.tenant_id, project_id),
        )
    ]
    outputs = [
        {
            "id": row["id"],
            "jobId": row["job_id"],
            "outputType": row["output_type"],
            "width": row["width"],
            "height": row["height"],
            "durationMs": row["duration_ms"],
            "sizeBytes": row["size_bytes"],
        }
        for row in studio.db.execute(
            "SELECT id,job_id,output_type,width,height,duration_ms,size_bytes "
            "FROM video_outputs WHERE tenant_id=? AND project_id=? ORDER BY job_id,output_type",
            (actor.tenant_id, project_id),
        )
    ]
    approvals = {
        row["preview_job_id"]
        for row in studio.db.execute(
            "SELECT preview_job_id FROM video_approvals "
            "WHERE tenant_id=? AND project_id=? AND consumed_by_job_id IS NULL",
            (actor.tenant_id, project_id),
        )
    }
    return {
        "id": project["id"],
        "title": project["title"],
        "status": project["status"],
        "templateId": project["template_id"],
        "videoType": project["video_type"],
        "niche": project["niche"],
        "revision": project["revision"],
        "config": safe_json(project["config_json"], {}),
        "updatedAt": project["updated_at"],
        "assets": assets,
        "jobs": jobs,
        "outputs": outputs,
        "approvedPreviewJobIds": sorted(approvals),
    }


def staged_upload_path(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("INVALID_UPLOAD")
    path = Path(value).resolve()
    if not path.is_relative_to(STAGING_ROOT) or not path.is_file() or path.is_symlink():
        raise ValueError("INVALID_UPLOAD")
    return path


def main():
    raw = sys.stdin.read()
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise ValueError("INVALID_REQUEST")

    action = request.get("action")
    tenant_id = request.get("tenantId")
    user_id = request.get("userId")
    payload = request.get("payload") or {}
    if not isinstance(action, str) or not isinstance(payload, dict):
        raise ValueError("INVALID_REQUEST")

    actor = Actor(tenant_id, user_id)
    storage = Path(os.environ.get("CITAYA_VIDEO_STORAGE_ROOT", str(DEFAULT_STORAGE))).resolve()
    studio = Studio(storage)
    try:
        if action == "list_projects":
            result = studio.list_projects(actor)
        elif action == "create_from_brief":
            title = str(payload.get("title") or "Nuevo video")
            config, report, usage = generate_tenant_config(
                brief=payload.get("brief"),
                business_name=payload.get("businessName"),
                niche=payload.get("niche"),
                style=payload.get("style"),
                duration_seconds=payload.get("durationSeconds"),
            )
            project_id = studio.create_project(actor, config, title)
            if usage is not None:
                try:
                    studio.record_ai_usage(
                        actor,
                        uid(),
                        usage,
                        project_id=project_id,
                        provider_mode="local",
                    )
                except Exception:
                    pass
            result = {
                "project": safe_project_detail(studio, actor, project_id),
                "report": report,
                "usage": usage,
            }
        elif action == "project_detail":
            result = safe_project_detail(studio, actor, str(payload.get("projectId", "")))
        elif action == "create_project":
            project_id = studio.create_project(
                actor,
                payload.get("config"),
                str(payload.get("title") or "Nuevo video"),
            )
            result = safe_project_detail(studio, actor, project_id)
        elif action == "update_project":
            project_id = str(payload.get("projectId", ""))
            studio.update_project(actor, project_id, payload.get("config"))
            result = safe_project_detail(studio, actor, project_id)
        elif action == "upload":
            project_id = str(payload.get("projectId", ""))
            asset_id = studio.upload(actor, project_id, staged_upload_path(payload.get("stagedPath")))
            result = {"assetId": asset_id}
        elif action == "validate":
            project_id = str(payload.get("projectId", ""))
            report = studio.validate_project(actor, project_id)
            result = {"report": report, "project": safe_project_detail(studio, actor, project_id)}
        elif action == "enqueue":
            project_id = str(payload.get("projectId", ""))
            mode = str(payload.get("mode", ""))
            key = str(payload.get("idempotencyKey", ""))
            job_id = studio.enqueue(actor, project_id, mode, key)
            result = {"jobId": job_id, "project": safe_project_detail(studio, actor, project_id)}
        elif action == "approve":
            preview_job_id = str(payload.get("previewJobId", ""))
            approval_id = studio.approve_final(actor, preview_job_id)
            job = studio.row("video_jobs", actor, preview_job_id)
            result = {
                "approvalId": approval_id,
                "project": safe_project_detail(studio, actor, job["project_id"]),
            }
        elif action == "usage":
            result = studio.usage_summary(actor)
        elif action == "download_path":
            output_id = str(payload.get("outputId", ""))
            output = studio.output(actor, output_id)
            path = studio.download_path(actor, output_id)
            result = {
                "path": str(path),
                "outputType": output["output_type"],
                "sizeBytes": output["size_bytes"],
            }
        else:
            raise ValueError("INVALID_ACTION")
        emit({"ok": True, "result": result})
    finally:
        studio.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        code = getattr(exc, "code", None)
        if not isinstance(code, str) or not code:
            code = str(exc) if str(exc).isupper() and len(str(exc)) <= 80 else "VIDEO_STUDIO_ERROR"
        emit({"ok": False, "code": code})
        raise SystemExit(1)
