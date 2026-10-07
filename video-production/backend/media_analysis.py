"""Private analysis persistence. No extraction loop, provider, semantic AI or UI.

Actor methods are tenant scoped. Worker methods require the current opaque lease
token and reload all authority from SQLite; never pass a caller-supplied job dict.
Publication is atomic in SQLite with compensating file cleanup on normal errors.
An abrupt process/host crash can leave private orphan files (never published rows).
Those files are not overwritten by retries; maintenance is a separate operation.
"""

from contextlib import ExitStack, contextmanager
import hashlib
import json
import os
from pathlib import Path
import time
import uuid

import extract_frames as extraction
from production import ConfigError, fail


def _id():
    return str(uuid.uuid4())


def _text(value, code="INVALID_ANALYSIS"):
    if not isinstance(value, str) or not 1 <= len(value) <= 100 or not value.strip():
        fail(code, "Nonempty version/key text up to 100 characters required.")
    return value


def _snapshot_hash(members):
    pairs = sorted((m["asset_id"], m["asset_sha256"]) for m in members)
    return hashlib.sha256(json.dumps(pairs, separators=(",", ":")).encode()).hexdigest()


def _hash_fd(fd):
    with os.fdopen(os.dup(fd), "rb") as stream:
        stream.seek(0)
        return hashlib.file_digest(stream, "sha256").hexdigest()


class AnalysisMixin:
    """Uses Studio's connection, BEGIN IMMEDIATE, Actor boundary and asset table."""

    def _analysis_row(self, table, actor, identifier):
        if table not in ("media_approval_sets", "video_analysis_jobs", "video_analysis_frames"):
            raise ValueError("analysis table")
        row = self.db.execute(f"SELECT * FROM {table} WHERE tenant_id=? AND id=?",
                              (actor.tenant_id, identifier)).fetchone()
        if row is None:
            fail("NOT_FOUND", "Resource not found in this tenant.")
        return dict(row)

    def media_approval(self, actor, approval_id):
        """Audit snapshot, including revoked approvals; not an authorization check."""
        approval = self._analysis_row("media_approval_sets", actor, approval_id)
        approval["members"] = [dict(row) for row in self.db.execute(
            "SELECT asset_id,asset_sha256 FROM media_approval_members "
            "WHERE tenant_id=? AND project_id=? AND approval_id=? ORDER BY asset_id",
            (actor.tenant_id, approval["project_id"], approval_id))]
        return approval

    def _check_asset_file(self, asset):
        relative = Path(asset["storage_path"])
        expected = Path(asset["tenant_id"]) / asset["project_id"] / "assets"
        if relative.is_absolute() or relative.parent != expected or relative.stem != asset["id"]:
            fail("ASSET_INTEGRITY", "Asset storage reference is invalid.")
        try:
            with extraction._source(self.root / relative) as (fd, _):
                if _hash_fd(fd) != asset["sha256"]:
                    fail("ASSET_INTEGRITY", "Asset bytes no longer match the registered hash.")
        except (OSError, ConfigError):
            fail("ASSET_INTEGRITY", "Asset is missing, unsafe or has changed.")

    def _check_approval(self, actor, approval_id, project_id):
        approval = self.media_approval(actor, approval_id)
        if approval["project_id"] != project_id:
            fail("APPROVAL_PROJECT_MISMATCH", "Approval belongs to another project.")
        if approval["revoked_at"] is not None:
            fail("MEDIA_APPROVAL_REVOKED", "Media approval was revoked.")
        if (not approval["sealed"] or len(approval["members"]) != approval["member_count"]
                or _snapshot_hash(approval["members"]) != approval["fingerprint"]):
            fail("MEDIA_APPROVAL_INVALID", "Approval snapshot is not intact.")
        assets = {}
        for member in approval["members"]:
            row = self.db.execute(
                "SELECT * FROM video_assets WHERE tenant_id=? AND project_id=? AND id=?",
                (actor.tenant_id, project_id, member["asset_id"])).fetchone()
            if row is None or row["sha256"] != member["asset_sha256"]:
                fail("ASSET_INTEGRITY", "Approved asset no longer matches its snapshot.")
            asset = dict(row)
            self._check_asset_file(asset)
            assets[asset["id"]] = asset
        return approval, assets

    def approve_media_set(self, actor, project_id, asset_ids):
        if (not isinstance(asset_ids, (list, tuple)) or not 1 <= len(asset_ids) <= 64
                or any(not isinstance(a, str) for a in asset_ids)
                or len(set(asset_ids)) != len(asset_ids)):
            fail("INVALID_MEDIA_SET", "Choose 1 to 64 distinct assets.")
        with self.tx():
            self.project(actor, project_id)
            members = []
            for asset_id in sorted(asset_ids):
                asset = self.row("video_assets", actor, asset_id)
                if asset["project_id"] != project_id:
                    fail("ASSET_PROJECT_MISMATCH", "Asset belongs to another project.")
                self._check_asset_file(asset)
                members.append({"asset_id": asset_id, "asset_sha256": asset["sha256"]})
            approval_id, now = _id(), time.time()
            self.db.execute(
                "INSERT INTO media_approval_sets(id,tenant_id,project_id,approved_by,approved_at,"
                "fingerprint,member_count,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (approval_id, actor.tenant_id, project_id, actor.user_id, now,
                 _snapshot_hash(members), len(members), now))
            self.db.executemany(
                "INSERT INTO media_approval_members VALUES(?,?,?,?,?)",
                [(approval_id, actor.tenant_id, project_id, m["asset_id"], m["asset_sha256"])
                 for m in members])
            self.db.execute("UPDATE media_approval_sets SET sealed=1 WHERE id=?", (approval_id,))
        return approval_id

    def revoke_media_set(self, actor, approval_id):
        with self.tx():
            approval = self.media_approval(actor, approval_id)
            if approval["revoked_at"] is None:
                self.db.execute("UPDATE media_approval_sets SET revoked_at=? WHERE tenant_id=? AND id=?",
                                (time.time(), actor.tenant_id, approval_id))
            self.db.execute(
                "UPDATE video_analysis_jobs SET status='failed',finished_at=?,lease_token=NULL,"
                "lease_until=NULL,error_code='MEDIA_APPROVAL_REVOKED' WHERE tenant_id=? AND approval_id=? "
                "AND status IN ('queued','running')", (time.time(), actor.tenant_id, approval_id))

    def analysis_job(self, actor, job_id):
        return self._analysis_row("video_analysis_jobs", actor, job_id)

    def _active_equivalent(self, job):
        return self.db.execute(
            "SELECT id FROM video_analysis_jobs WHERE tenant_id=? AND project_id=? "
            "AND approval_fingerprint=? AND strategy_version=? AND extractor_version=? "
            "AND status IN ('queued','running')",
            (job["tenant_id"], job["project_id"], job["approval_fingerprint"],
             job["strategy_version"], job["extractor_version"])).fetchone()

    def enqueue_analysis(self, actor, project_id, approval_id, idempotency_key, *,
                         strategy_version, extractor_version):
        for value in (idempotency_key, strategy_version, extractor_version):
            _text(value)
        with self.tx():
            self.project(actor, project_id)
            approval, _ = self._check_approval(actor, approval_id, project_id)
            existing = self.db.execute(
                "SELECT * FROM video_analysis_jobs WHERE tenant_id=? AND project_id=? "
                "AND approval_id=? AND idempotency_key=?",
                (actor.tenant_id, project_id, approval_id, idempotency_key)).fetchone()
            if existing:
                if (existing["strategy_version"], existing["extractor_version"]) != (strategy_version, extractor_version):
                    fail("IDEMPOTENCY_CONFLICT", "Key already belongs to different analysis versions.")
                return existing["id"]
            context = dict(tenant_id=actor.tenant_id, project_id=project_id,
                           approval_fingerprint=approval["fingerprint"],
                           strategy_version=strategy_version, extractor_version=extractor_version)
            if self._active_equivalent(context):
                fail("ANALYSIS_ALREADY_ACTIVE", "Equivalent analysis is already queued or running.")
            job_id = _id()
            self.db.execute(
                "INSERT INTO video_analysis_jobs(id,tenant_id,project_id,approval_id,approval_fingerprint,"
                "status,idempotency_key,strategy_version,extractor_version,queued_at,lease_seconds) "
                "VALUES(?,?,?,?,?,'queued',?,?,?,?,1800)",
                (job_id, actor.tenant_id, project_id, approval_id, approval["fingerprint"],
                 idempotency_key, strategy_version, extractor_version, time.time()))
        return job_id

    def _fail_analysis(self, job_id, code):
        self.db.execute(
            "UPDATE video_analysis_jobs SET status='failed',finished_at=?,error_code=?,"
            "lease_token=NULL,lease_until=NULL WHERE id=? AND status IN ('queued','running')",
            (time.time(), code, job_id))

    def _analysis_actor(self, job):
        # Deferred import avoids a cycle with Studio's mixin import.
        from studio import Actor
        owner = self.db.execute(
            "SELECT approved_by FROM media_approval_sets WHERE tenant_id=? AND project_id=? AND id=?",
            (job["tenant_id"], job["project_id"], job["approval_id"])).fetchone()
        return Actor(job["tenant_id"], owner["approved_by"])

    def _check_analysis_approval(self, job):
        try:
            return self._check_approval(self._analysis_actor(job), job["approval_id"], job["project_id"])[1]
        except ConfigError as error:
            self._fail_analysis(job["id"], error.code)
            return None

    def claim_analysis(self, node, lease_seconds=1800):
        _text(node)
        if type(lease_seconds) is not int or not 1 <= lease_seconds <= 3600:
            fail("INVALID_LEASE", "Lease must be between 1 and 3600 seconds.")
        with self.tx():
            self.db.execute(
                "UPDATE video_analysis_jobs SET status='failed',finished_at=?,error_code='LEASE_EXPIRED',"
                "lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<=?",
                (time.time(), time.time()))
            for row in self.db.execute("SELECT * FROM video_analysis_jobs WHERE status='queued' ORDER BY queued_at,id").fetchall():
                job = dict(row)
                if self._check_analysis_approval(job) is None:
                    continue
                now, token = time.time(), _id()
                self.db.execute(
                    "UPDATE video_analysis_jobs SET status='running',started_at=?,worker_node=?,"
                    "attempt=attempt+1,lease_token=?,lease_until=?,lease_seconds=? WHERE id=?",
                    (now, node, token, now + lease_seconds, lease_seconds, job["id"]))
                return dict(self.db.execute("SELECT * FROM video_analysis_jobs WHERE id=?", (job["id"],)).fetchone())
        return None

    def _leased_analysis(self, job_id, lease_token):
        row = self.db.execute("SELECT * FROM video_analysis_jobs WHERE id=?", (job_id,)).fetchone()
        if not row or row["status"] != "running" or not lease_token or row["lease_token"] != lease_token:
            return None
        if row["lease_until"] <= time.time():
            self._fail_analysis(job_id, "LEASE_EXPIRED")
            return None
        return dict(row)

    def prepare_analysis(self, job_id, lease_token):
        """Trusted worker revalidates immediately before real work; no extraction."""
        with self.tx():
            job = self._leased_analysis(job_id, lease_token)
            if job is None:
                return None
            assets = self._check_analysis_approval(job)
            if assets is None or self._leased_analysis(job_id, lease_token) is None:
                return None
            return {"job": job, "assets": list(assets.values())}

    def heartbeat_analysis(self, job_id, lease_token):
        with self.tx():
            job = self._leased_analysis(job_id, lease_token)
            if job is None or self._check_analysis_approval(job) is None:
                return False
            if self._leased_analysis(job_id, lease_token) is None:
                return False
            self.db.execute("UPDATE video_analysis_jobs SET lease_until=? WHERE id=?",
                            (time.time() + job["lease_seconds"], job_id))
            return True

    def cancel_analysis(self, actor, job_id):
        with self.tx():
            job = self.analysis_job(actor, job_id)
            if job["status"] not in ("queued", "running"):
                fail("INVALID_TRANSITION", "Only queued/running analysis can be cancelled.")
            self.db.execute(
                "UPDATE video_analysis_jobs SET status='cancelled',finished_at=?,lease_token=NULL,lease_until=NULL "
                "WHERE tenant_id=? AND id=?", (time.time(), actor.tenant_id, job_id))

    def retry_analysis(self, actor, job_id):
        with self.tx():
            job = self.analysis_job(actor, job_id)
            if job["status"] != "failed":
                fail("INVALID_TRANSITION", "Only failed analysis can be retried.")
            self._check_approval(actor, job["approval_id"], job["project_id"])
            if self._active_equivalent(job):
                fail("ANALYSIS_ALREADY_ACTIVE", "Equivalent analysis is active.")
            self.db.execute(
                "UPDATE video_analysis_jobs SET status='queued',queued_at=?,started_at=NULL,finished_at=NULL,"
                "worker_node=NULL,error_code=NULL,lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND id=?",
                (time.time(), actor.tenant_id, job_id))
        return job_id

    @contextmanager
    def _analysis_directory(self, parts):
        """Create/open private descendants through descriptors, never symlinks."""
        fd = extraction._directory(self.root)
        try:
            for part in parts:
                if not part or part in (".", "..") or "/" in part:
                    fail("UNSAFE_ANALYSIS_PATH", "Invalid private directory component.")
                try:
                    os.mkdir(part, mode=0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
            yield fd
        finally:
            os.close(fd)

    def _workspace_parts(self, job):
        return (job["tenant_id"], job["project_id"], "work", "analysis", job["id"], job["lease_token"])

    def analysis_workspace(self, job_id, lease_token):
        """Internal temporary root. Workers write <asset_id>/frame-NNNN.jpg here."""
        prepared = self.prepare_analysis(job_id, lease_token)
        if prepared is None:
            fail("ANALYSIS_LEASE_INVALID", "No active authorized analysis lease.")
        parts = self._workspace_parts(prepared["job"])
        with self._analysis_directory(parts):
            return self.root.joinpath(*parts)

    def _frame_descriptors(self, descriptors, assets):
        if not isinstance(descriptors, (list, tuple)) or len(descriptors) > 256:
            fail("INVALID_ANALYSIS_FRAME", "At most 256 frame descriptors are accepted.")
        seen = set()
        for frame in descriptors:
            if not isinstance(frame, dict) or set(frame) != {"asset_id", "frame_index", "timestamp_ms"}:
                fail("INVALID_ANALYSIS_FRAME", "Frames accept only asset, index and timestamp; never paths or hashes.")
            if not isinstance(frame["asset_id"], str) or frame["asset_id"] not in assets:
                fail("ANALYSIS_ASSET_MISMATCH", "Frame asset is outside the approved job.")
            index, timestamp = frame["frame_index"], frame["timestamp_ms"]
            if type(index) is not int or not 1 <= index <= 64 or type(timestamp) is not int or not 0 <= timestamp <= 600000:
                fail("INVALID_ANALYSIS_FRAME", "Invalid frame index or timestamp.")
            asset = assets[frame["asset_id"]]
            if asset["asset_type"] not in ("image", "video") or (asset["asset_type"] == "image" and timestamp != 0):
                fail("INVALID_ANALYSIS_FRAME", "Frame is incompatible with its source type.")
            key = (frame["asset_id"], index)
            if key in seen:
                fail("DUPLICATE_ANALYSIS_FRAME", "Frame index already supplied for this asset.")
            seen.add(key)
        return sorted(descriptors, key=lambda f: (f["asset_id"], f["frame_index"]))

    def _result_descriptors(self, descriptors, assets):
        if not isinstance(descriptors, (list, tuple)) or len(descriptors) > 64:
            fail("INVALID_ANALYSIS_RESULT", "At most 64 results are accepted.")
        seen = set()
        for result in descriptors:
            if not isinstance(result, dict) or set(result) != {"asset_id", "schema_version", "status"}:
                fail("INVALID_ANALYSIS_RESULT", "Only asset, schema version and status are supported in this block.")
            if not isinstance(result["asset_id"], str) or result["asset_id"] not in assets:
                fail("ANALYSIS_ASSET_MISMATCH", "Result asset is outside the approved job.")
            _text(result["schema_version"], "INVALID_ANALYSIS_RESULT")
            if result["status"] not in ("unknown", "partial", "complete"):
                fail("INVALID_ANALYSIS_RESULT", "Unsupported result status.")
            key = (result["asset_id"], result["schema_version"])
            if key in seen:
                fail("INVALID_ANALYSIS_RESULT", "Duplicate result version.")
            seen.add(key)
        return descriptors

    def _copy_analysis_frame(self, job, frame, stack, created):
        asset_id = frame["asset_id"]
        name = f"frame-{frame['frame_index']:04d}.jpg"
        source = self.root.joinpath(*self._workspace_parts(job), asset_id, name)
        parts = (job["tenant_id"], job["project_id"], "analysis", asset_id, job["id"])
        directory = stack.enter_context(self._analysis_directory(parts))
        with extraction._source(source) as (source_fd, original):
            if original.st_size > 8 * 1024 * 1024:
                fail("INVALID_ANALYSIS_FRAME", "Frame exceeds 8 MiB.")
            target_fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            created.append((directory, name, os.fstat(target_fd).st_ino))
            with os.fdopen(target_fd, "w+b") as target, os.fdopen(os.dup(source_fd), "rb") as src:
                copied = 0
                while chunk := src.read(65536):
                    copied += len(chunk)
                    if copied > 8 * 1024 * 1024:
                        fail("INVALID_ANALYSIS_FRAME", "Frame exceeds 8 MiB.")
                    target.write(chunk)
                target.flush()
                after = os.fstat(source_fd)
                if (original.st_size, original.st_mtime_ns, original.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    fail("INVALID_ANALYSIS_FRAME", "Temporary evidence changed during copy.")
                probe = extraction._probe(target.fileno(), "jpeg_pipe")
                stream = probe["streams"][0]
                width, height = stream["width"], stream["height"]
                if not 1 <= min(width, height) <= max(width, height) <= 1280:
                    fail("INVALID_ANALYSIS_FRAME", "Evidence must be a JPEG proxy up to 1280px.")
                sha256 = _hash_fd(target.fileno())
                os.fsync(target.fileno())
        return dict(id=_id(), tenant_id=job["tenant_id"], project_id=job["project_id"],
                    analysis_job_id=job["id"], approval_id=job["approval_id"], asset_id=asset_id,
                    frame_index=frame["frame_index"], timestamp_ms=frame["timestamp_ms"],
                    width=width, height=height, size_bytes=copied, sha256=sha256,
                    storage_path=str(Path(*parts) / name), created_at=time.time())

    def _insert_analysis_frame(self, frame):
        columns = tuple(frame)
        self.db.execute("INSERT INTO video_analysis_frames(" + ",".join(columns)
                        + ") VALUES(" + ",".join("?" for _ in columns) + ")", tuple(frame.values()))

    def finish_analysis(self, job_id, lease_token, *, frames=(), results=(), error=None):
        """Publish evidence + metadata in one fenced transaction. No semantic data.

        Temporary filenames and all final paths, dimensions and hashes are derived
        server-side. A stale/revoked worker gets False and cannot publish anything.
        Invalid payloads raise and leave the current job available for correction.
        """
        created, committed = [], False
        with ExitStack() as stack:
            try:
                with self.tx():
                    job = self._leased_analysis(job_id, lease_token)
                    if job is None:
                        return False
                    assets = self._check_analysis_approval(job)
                    if assets is None:
                        return False
                    if error is not None:
                        _text(error)
                        self._fail_analysis(job_id, error)
                        return False
                    frames = self._frame_descriptors(frames, assets)
                    results = self._result_descriptors(results, assets)
                    copies = [self._copy_analysis_frame(job, frame, stack, created) for frame in frames]
                    # File writes can race external changes and take longer than a
                    # lease. Recheck both immediately before publishing DB rows.
                    if self._check_analysis_approval(job) is None or self._leased_analysis(job_id, lease_token) is None:
                        return False
                    self.db.execute("SAVEPOINT analysis_publication")
                    for frame in copies:
                        self._insert_analysis_frame(frame)
                    for result in results:
                        manifest = [{k: f[k] for k in ("id", "frame_index", "timestamp_ms", "width", "height", "sha256")}
                                    for f in copies if f["asset_id"] == result["asset_id"]]
                        body = json.dumps({"status": result["status"], "manifest": manifest}, sort_keys=True, separators=(",", ":"))
                        self.db.execute(
                            "INSERT INTO video_analysis_results(id,tenant_id,project_id,analysis_job_id,approval_id,asset_id,"
                            "schema_version,provider,model,status,result_json,created_at) VALUES(?,?,?,?,?,?,?,'none',NULL,?,?,?)",
                            (_id(), job["tenant_id"], job["project_id"], job_id, job["approval_id"], result["asset_id"],
                             result["schema_version"], result["status"], body, time.time()))
                    changed = self.db.execute(
                        "UPDATE video_analysis_jobs SET status='completed',finished_at=?,lease_token=NULL,lease_until=NULL "
                        "WHERE id=? AND status='running' AND lease_token=? AND lease_until>?",
                        (time.time(), job_id, lease_token, time.time())).rowcount
                    if not changed:
                        self.db.execute("ROLLBACK TO analysis_publication")
                        self.db.execute("RELEASE analysis_publication")
                        self._fail_analysis(job_id, "LEASE_EXPIRED")
                        return False
                    self.db.execute("RELEASE analysis_publication")
                committed = True
                return True
            finally:
                if not committed:
                    for directory, name, inode in reversed(created):
                        try:
                            if os.stat(name, dir_fd=directory, follow_symlinks=False).st_ino == inode:
                                os.unlink(name, dir_fd=directory)
                        except FileNotFoundError:
                            pass

    def _read_analysis(self, actor, job_id, table):
        if table not in ("video_analysis_frames", "video_analysis_results"):
            raise ValueError("analysis output table")
        with self.tx():
            job = self.analysis_job(actor, job_id)
            self._check_approval(actor, job["approval_id"], job["project_id"])
            if job["status"] != "completed":
                fail("ANALYSIS_NOT_COMPLETED", "Analysis has not completed.")
            return [dict(row) for row in self.db.execute(
                f"SELECT * FROM {table} WHERE tenant_id=? AND project_id=? AND analysis_job_id=? ORDER BY asset_id,created_at,id",
                (actor.tenant_id, job["project_id"], job_id))]

    def analysis_frames(self, actor, job_id):
        return self._read_analysis(actor, job_id, "video_analysis_frames")

    def analysis_results(self, actor, job_id):
        return self._read_analysis(actor, job_id, "video_analysis_results")
