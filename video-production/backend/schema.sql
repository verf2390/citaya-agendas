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
