-- Local foundation only. Never applied to the Citaya production database.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS video_projects (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, created_by TEXT NOT NULL,
 template_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','validated','queued','rendering','completed','failed','cancelled')),
 title TEXT NOT NULL, video_type TEXT NOT NULL, niche TEXT NOT NULL,
 config_json TEXT NOT NULL, normalized_config_json TEXT, revision INTEGER NOT NULL DEFAULT 1,
 created_at REAL NOT NULL, updated_at REAL NOT NULL, UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS video_assets (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
 asset_type TEXT NOT NULL, storage_path TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), duration_ms INTEGER NOT NULL DEFAULT 0,
 width INTEGER, height INTEGER, sha256 TEXT NOT NULL, created_at REAL NOT NULL,
 UNIQUE(tenant_id,project_id,sha256), UNIQUE(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES video_projects(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS video_jobs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('validated','queued','rendering','completed','failed','cancelled')),
 mode TEXT NOT NULL CHECK(mode IN ('preview','final')), idempotency_key TEXT NOT NULL,
 config_json TEXT NOT NULL, fingerprint TEXT NOT NULL, queued_at REAL NOT NULL,
 started_at REAL, finished_at REAL, error_code TEXT, render_node TEXT, render_seconds REAL NOT NULL DEFAULT 0,
 cpu_seconds REAL NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until REAL,
 UNIQUE(tenant_id,project_id,mode,idempotency_key), UNIQUE(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES video_projects(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS video_approvals (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, preview_job_id TEXT NOT NULL,
 revision INTEGER NOT NULL, fingerprint TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at REAL NOT NULL,
 consumed_by_job_id TEXT,
 FOREIGN KEY(tenant_id,project_id,preview_job_id) REFERENCES video_jobs(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,consumed_by_job_id) REFERENCES video_jobs(tenant_id,project_id,id)
);
CREATE TABLE IF NOT EXISTS video_outputs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
 output_type TEXT NOT NULL, storage_path TEXT NOT NULL UNIQUE, width INTEGER, height INTEGER,
 duration_ms INTEGER, size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), sha256 TEXT NOT NULL,
 UNIQUE(tenant_id,job_id,output_type),
 FOREIGN KEY(tenant_id,project_id,job_id) REFERENCES video_jobs(tenant_id,project_id,id)
);
CREATE TABLE IF NOT EXISTS video_usage_events (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, period TEXT NOT NULL, event_key TEXT NOT NULL,
 event_type TEXT NOT NULL, provider TEXT, provider_mode TEXT CHECK(provider_mode IN ('local','cloud') OR provider_mode IS NULL),
 metrics_json TEXT NOT NULL, created_at REAL NOT NULL, UNIQUE(tenant_id,event_key)
);
CREATE TABLE IF NOT EXISTS video_usage (
 tenant_id TEXT NOT NULL, period TEXT NOT NULL,
 previews_generated INTEGER NOT NULL DEFAULT 0, finals_generated INTEGER NOT NULL DEFAULT 0,
 render_seconds REAL NOT NULL DEFAULT 0, cpu_seconds REAL NOT NULL DEFAULT 0,
 ai_input_tokens INTEGER NOT NULL DEFAULT 0, ai_output_tokens INTEGER NOT NULL DEFAULT 0,
 storage_bytes INTEGER NOT NULL DEFAULT 0, uploaded_bytes INTEGER NOT NULL DEFAULT 0, output_bytes INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,period)
);
CREATE INDEX IF NOT EXISTS projects_by_tenant ON video_projects(tenant_id,updated_at);
CREATE INDEX IF NOT EXISTS assets_by_project ON video_assets(tenant_id,project_id);
CREATE INDEX IF NOT EXISTS jobs_claim ON video_jobs(status,queued_at);
CREATE INDEX IF NOT EXISTS jobs_by_project ON video_jobs(tenant_id,project_id,queued_at);
CREATE INDEX IF NOT EXISTS outputs_by_project ON video_outputs(tenant_id,project_id);

-- Visual analysis: private, independent of the render queue and its approvals.
CREATE TABLE IF NOT EXISTS media_approval_sets (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
 approved_by TEXT NOT NULL CHECK(length(approved_by)>0), approved_at REAL NOT NULL,
 revoked_at REAL CHECK(revoked_at IS NULL OR revoked_at>=approved_at),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
 member_count INTEGER NOT NULL CHECK(typeof(member_count)='integer' AND member_count BETWEEN 1 AND 64),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)), created_at REAL NOT NULL,
 UNIQUE(tenant_id,project_id,id), UNIQUE(tenant_id,project_id,id,fingerprint),
 FOREIGN KEY(tenant_id,project_id) REFERENCES video_projects(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS media_approval_members (
 approval_id TEXT NOT NULL, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
 asset_id TEXT NOT NULL,
 asset_sha256 TEXT NOT NULL CHECK(length(asset_sha256)=64 AND asset_sha256 NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(tenant_id,project_id,approval_id,asset_id),
 FOREIGN KEY(tenant_id,project_id,approval_id) REFERENCES media_approval_sets(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,asset_id) REFERENCES video_assets(tenant_id,project_id,id)
);
CREATE TABLE IF NOT EXISTS video_analysis_jobs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
 approval_id TEXT NOT NULL, approval_fingerprint TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 100),
 strategy_version TEXT NOT NULL CHECK(length(trim(strategy_version)) BETWEEN 1 AND 100),
 extractor_version TEXT NOT NULL CHECK(length(trim(extractor_version)) BETWEEN 1 AND 100),
 queued_at REAL NOT NULL, started_at REAL, finished_at REAL,
 attempt INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempt)='integer' AND attempt>=0), worker_node TEXT,
 lease_token TEXT, lease_until REAL, lease_seconds INTEGER NOT NULL CHECK(typeof(lease_seconds)='integer' AND lease_seconds BETWEEN 1 AND 3600),
 error_code TEXT,
 UNIQUE(tenant_id,project_id,approval_id,idempotency_key),
 UNIQUE(tenant_id,project_id,id), UNIQUE(tenant_id,project_id,id,approval_id),
 FOREIGN KEY(tenant_id,project_id,approval_id,approval_fingerprint)
   REFERENCES media_approval_sets(tenant_id,project_id,id,fingerprint),
 CHECK((status='running' AND lease_token IS NOT NULL AND lease_until>started_at
          AND started_at IS NOT NULL AND finished_at IS NULL AND worker_node IS NOT NULL AND attempt>0)
    OR (status='queued' AND lease_token IS NULL AND lease_until IS NULL AND started_at IS NULL AND finished_at IS NULL)
    OR (status IN ('completed','failed','cancelled') AND lease_token IS NULL AND lease_until IS NULL AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS analysis_active_equivalent ON video_analysis_jobs
 (tenant_id,project_id,approval_fingerprint,strategy_version,extractor_version)
 WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS video_analysis_frames (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
 analysis_job_id TEXT NOT NULL, approval_id TEXT NOT NULL, asset_id TEXT NOT NULL,
 frame_index INTEGER NOT NULL CHECK(typeof(frame_index)='integer' AND frame_index BETWEEN 1 AND 64),
 timestamp_ms INTEGER NOT NULL CHECK(typeof(timestamp_ms)='integer' AND timestamp_ms>=0),
 width INTEGER NOT NULL CHECK(typeof(width)='integer' AND width BETWEEN 1 AND 1280),
 height INTEGER NOT NULL CHECK(typeof(height)='integer' AND height BETWEEN 1 AND 1280),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 storage_path TEXT NOT NULL UNIQUE, created_at REAL NOT NULL,
 UNIQUE(tenant_id,project_id,analysis_job_id,asset_id,frame_index),
 UNIQUE(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,analysis_job_id,approval_id)
   REFERENCES video_analysis_jobs(tenant_id,project_id,id,approval_id),
 FOREIGN KEY(tenant_id,project_id,approval_id,asset_id)
   REFERENCES media_approval_members(tenant_id,project_id,approval_id,asset_id),
 CHECK(storage_path=tenant_id||'/'||project_id||'/analysis/'||asset_id||'/'||analysis_job_id||'/'||printf('frame-%04d.jpg',frame_index)),
 CHECK(tenant_id NOT GLOB '*[^0-9a-f-]*' AND project_id NOT GLOB '*[^0-9a-f-]*'
   AND asset_id NOT GLOB '*[^0-9a-f-]*' AND analysis_job_id NOT GLOB '*[^0-9a-f-]*')
);
CREATE TABLE IF NOT EXISTS video_analysis_results (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
 analysis_job_id TEXT NOT NULL, approval_id TEXT NOT NULL, asset_id TEXT NOT NULL,
 schema_version TEXT NOT NULL CHECK(length(trim(schema_version)) BETWEEN 1 AND 100),
 provider TEXT NOT NULL CHECK(length(trim(provider))>0), model TEXT,
 status TEXT NOT NULL CHECK(status IN ('unknown','partial','complete')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 original_result_json TEXT CHECK(original_result_json IS NULL OR json_valid(original_result_json)),
 supersedes_result_id TEXT, corrected_by TEXT, corrected_at REAL, created_at REAL NOT NULL,
 UNIQUE(tenant_id,project_id,analysis_job_id,asset_id,schema_version,revision),
 UNIQUE(tenant_id,project_id,analysis_job_id,asset_id,schema_version,id),
 FOREIGN KEY(tenant_id,project_id,analysis_job_id,approval_id)
   REFERENCES video_analysis_jobs(tenant_id,project_id,id,approval_id),
 FOREIGN KEY(tenant_id,project_id,approval_id,asset_id)
   REFERENCES media_approval_members(tenant_id,project_id,approval_id,asset_id),
 FOREIGN KEY(tenant_id,project_id,analysis_job_id,asset_id,schema_version,supersedes_result_id)
   REFERENCES video_analysis_results(tenant_id,project_id,analysis_job_id,asset_id,schema_version,id),
 CHECK(json_type(result_json)='object' AND json_extract(result_json,'$.status') IS status),
 CHECK((revision=1 AND original_result_json IS NULL AND supersedes_result_id IS NULL
          AND corrected_by IS NULL AND corrected_at IS NULL)
    OR (revision>1 AND original_result_json IS NOT NULL AND supersedes_result_id IS NOT NULL
          AND corrected_by IS NOT NULL AND length(trim(corrected_by))>0
          AND corrected_at IS NOT NULL AND corrected_at<=created_at))
);
CREATE INDEX IF NOT EXISTS media_approvals_project ON media_approval_sets(tenant_id,project_id,created_at);
CREATE INDEX IF NOT EXISTS analysis_jobs_claim ON video_analysis_jobs(status,queued_at,id);
CREATE INDEX IF NOT EXISTS analysis_jobs_project ON video_analysis_jobs(tenant_id,project_id,queued_at);
CREATE INDEX IF NOT EXISTS analysis_frames_job ON video_analysis_frames(tenant_id,project_id,analysis_job_id,asset_id);
CREATE INDEX IF NOT EXISTS analysis_results_job ON video_analysis_results(tenant_id,project_id,analysis_job_id,asset_id);

-- An approval is built and sealed inside one BEGIN IMMEDIATE transaction.
CREATE TRIGGER IF NOT EXISTS media_approval_insert_unsealed BEFORE INSERT ON media_approval_sets
 WHEN NEW.sealed!=0 OR NEW.revoked_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'APPROVAL_MUST_START_UNSEALED'); END;
CREATE TRIGGER IF NOT EXISTS media_approval_immutable BEFORE UPDATE ON media_approval_sets
 WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.project_id IS NOT OLD.project_id
   OR NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_at IS NOT OLD.approved_at
   OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.created_at IS NOT OLD.created_at
   OR NEW.member_count IS NOT OLD.member_count OR NEW.sealed<OLD.sealed
   OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_APPROVAL'); END;
CREATE TRIGGER IF NOT EXISTS media_approval_seal BEFORE UPDATE OF sealed ON media_approval_sets
 WHEN NEW.sealed=1 AND (
   (SELECT COUNT(*) FROM media_approval_members WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND approval_id=NEW.id)!=NEW.member_count
   OR EXISTS(SELECT 1 FROM media_approval_members m JOIN video_assets a
     ON a.tenant_id=m.tenant_id AND a.project_id=m.project_id AND a.id=m.asset_id
     WHERE m.tenant_id=NEW.tenant_id AND m.project_id=NEW.project_id AND m.approval_id=NEW.id AND m.asset_sha256!=a.sha256))
 BEGIN SELECT RAISE(ABORT,'INVALID_APPROVAL_SNAPSHOT'); END;
CREATE TRIGGER IF NOT EXISTS media_approval_no_delete BEFORE DELETE ON media_approval_sets
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_APPROVAL'); END;
CREATE TRIGGER IF NOT EXISTS media_member_insert BEFORE INSERT ON media_approval_members
 WHEN (SELECT sealed FROM media_approval_sets WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=NEW.approval_id)!=0
 BEGIN SELECT RAISE(ABORT,'SEALED_APPROVAL'); END;
CREATE TRIGGER IF NOT EXISTS media_member_no_update BEFORE UPDATE ON media_approval_members
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_APPROVAL'); END;
CREATE TRIGGER IF NOT EXISTS media_member_no_delete BEFORE DELETE ON media_approval_members
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_APPROVAL'); END;
CREATE TRIGGER IF NOT EXISTS analysis_job_active_approval BEFORE INSERT ON video_analysis_jobs
 WHEN NOT EXISTS(SELECT 1 FROM media_approval_sets WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id
   AND id=NEW.approval_id AND sealed=1 AND revoked_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'INACTIVE_APPROVAL'); END;
CREATE TRIGGER IF NOT EXISTS analysis_job_context_immutable BEFORE UPDATE ON video_analysis_jobs
 WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.project_id IS NOT OLD.project_id
   OR NEW.approval_id IS NOT OLD.approval_id OR NEW.approval_fingerprint IS NOT OLD.approval_fingerprint
   OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.strategy_version IS NOT OLD.strategy_version
   OR NEW.extractor_version IS NOT OLD.extractor_version
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ANALYSIS_CONTEXT'); END;
CREATE TRIGGER IF NOT EXISTS analysis_job_transition BEFORE UPDATE OF status ON video_analysis_jobs
 WHEN NEW.status!=OLD.status AND NOT (
   (OLD.status='queued' AND NEW.status IN ('running','failed','cancelled'))
   OR (OLD.status='running' AND NEW.status IN ('completed','failed','cancelled'))
   OR (OLD.status='failed' AND NEW.status='queued'))
 BEGIN SELECT RAISE(ABORT,'INVALID_ANALYSIS_TRANSITION'); END;
CREATE TRIGGER IF NOT EXISTS analysis_frame_running BEFORE INSERT ON video_analysis_frames
 WHEN NOT EXISTS(SELECT 1 FROM video_analysis_jobs j JOIN media_approval_sets a
   ON a.tenant_id=j.tenant_id AND a.project_id=j.project_id AND a.id=j.approval_id
   WHERE j.tenant_id=NEW.tenant_id AND j.project_id=NEW.project_id AND j.id=NEW.analysis_job_id
   AND j.status='running' AND a.sealed=1 AND a.revoked_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'ANALYSIS_NOT_RUNNING'); END;
CREATE TRIGGER IF NOT EXISTS analysis_frame_no_update BEFORE UPDATE ON video_analysis_frames
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ANALYSIS_FRAME'); END;
CREATE TRIGGER IF NOT EXISTS analysis_frame_no_delete BEFORE DELETE ON video_analysis_frames
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ANALYSIS_FRAME'); END;
CREATE TRIGGER IF NOT EXISTS analysis_result_initial_running BEFORE INSERT ON video_analysis_results
 WHEN NEW.revision=1 AND NOT EXISTS(SELECT 1 FROM video_analysis_jobs j JOIN media_approval_sets a
   ON a.tenant_id=j.tenant_id AND a.project_id=j.project_id AND a.id=j.approval_id
   WHERE j.tenant_id=NEW.tenant_id AND j.project_id=NEW.project_id AND j.id=NEW.analysis_job_id
   AND j.status='running' AND a.sealed=1 AND a.revoked_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'ANALYSIS_NOT_RUNNING'); END;
CREATE TRIGGER IF NOT EXISTS analysis_result_correction BEFORE INSERT ON video_analysis_results
 WHEN NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM video_analysis_results prior
   WHERE prior.tenant_id=NEW.tenant_id AND prior.project_id=NEW.project_id
   AND prior.analysis_job_id=NEW.analysis_job_id AND prior.asset_id=NEW.asset_id
   AND prior.schema_version=NEW.schema_version AND prior.id=NEW.supersedes_result_id
   AND NEW.revision=prior.revision+1 AND NEW.corrected_at>=prior.created_at
   AND NEW.original_result_json=COALESCE(prior.original_result_json,prior.result_json))
 BEGIN SELECT RAISE(ABORT,'INVALID_CORRECTION_HISTORY'); END;
CREATE TRIGGER IF NOT EXISTS analysis_result_no_update BEFORE UPDATE ON video_analysis_results
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ANALYSIS_RESULT'); END;
CREATE TRIGGER IF NOT EXISTS analysis_result_no_delete BEFORE DELETE ON video_analysis_results
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ANALYSIS_RESULT'); END;
