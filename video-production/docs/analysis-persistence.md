# Visual analysis persistence (CIT-126, block 2)

Internal Python API only. No bridge/UI actions, background service, extractor
loop, provider calls, semantic classification, or render changes are included.
`Studio` exposes the methods through `AnalysisMixin`; its existing render API and
`row()` whitelist are unchanged. `video_assets` remains the asset authority.

## Storage and approval

`media_approval_sets` + `media_approval_members` store an exact, ordered snapshot
of asset IDs and their registered SHA-256 values. The server checks the bytes too.
The fingerprint is SHA-256 of compact JSON containing sorted `[asset_id, hash]`
pairs. A set is built and sealed inside `BEGIN IMMEDIATE`. SQLite prevents adding,
changing or deleting members after sealing, changing approval identity, deleting
history, or undoing revocation. No caller fingerprint/hash is accepted.

An upload cannot extend an approval. Revocation fails its queued/running analysis
jobs immediately. Completed evidence remains for audit but authorized reads reject
it after revocation or source integrity failure. The old `config.mediaApproved`
flag is not consulted by this API.

## Queue and workers

`video_analysis_jobs` is independent of `video_jobs`:

```
queued -> running -> completed | failed | cancelled
queued -> failed | cancelled
failed -> queued (explicit retry only)
```

Idempotency scope is `(tenant, project, approval, key)`. Reusing that key with
different strategy/extractor versions fails. A partial unique index prevents
simultaneous equivalent jobs by `(tenant, project, snapshot fingerprint,
strategy version, extractor version)`, including identical snapshots with
different approval IDs. Different versions are intentionally distinct contexts.

Worker methods are trusted internal APIs; possession of a current lease token
is required. They reload identity/context from the database, never a supplied job
dictionary. `prepare_analysis` rechecks approval and source bytes immediately
before work. Heartbeats cannot renew expired leases. Expiration requires an
explicit retry, retains job identity/key, and creates a new token on the next
claim. No changes to project render status occur.

```python
approval_id = studio.approve_media_set(actor, project_id, [asset_id])
job_id = studio.enqueue_analysis(
    actor, project_id, approval_id, "request-1",
    strategy_version="uniform-scene-v1", extractor_version="frames-v1",
)
job = studio.claim_analysis("internal-worker", lease_seconds=1800)
prepared = studio.prepare_analysis(job["id"], job["lease_token"])
# If prepared is None, the worker must stop. No extractor/model runs here.
workspace = studio.analysis_workspace(job["id"], job["lease_token"])
# A future trusted extractor writes workspace/<asset_id>/frame-0001.jpg.
studio.finish_analysis(
    job["id"], job["lease_token"],
    frames=[{"asset_id": asset_id, "frame_index": 1, "timestamp_ms": 0}],
    results=[{"asset_id": asset_id, "schema_version": "media-evidence-v1",
              "status": "partial"}],
)
```

`analysis_job`, `media_approval`, `cancel_analysis`, `retry_analysis`,
`revoke_media_set`, `analysis_frames`, and `analysis_results` take an authenticated
server-derived Actor. There is no public HTTP surface for these actions.

## Atomic evidence publication

The workspace is server-derived under
`<root>/<tenant>/<project>/work/analysis/<job>/<lease-token>/`.
`finish_analysis` accepts only asset/index/timestamp descriptors. It never accepts
source or destination paths, dimensions, or hashes. It opens the fixed internal
JPEG sources without following symlinks, copies them exclusively, computes hashes
and probes dimensions server-side using block 1's single-file FFprobe helpers.

Final evidence is stored at:
`<root>/<tenant>/<project>/analysis/<asset>/<job>/frame-NNNN.jpg`.
Directories are private (0700); files are 0600. SQLite checks the exact path
shape and binds each frame/result to BOTH its job/approval and approved asset.
No URLs are generated, and derived evidence is not shared between tenants.

Publication rechecks source integrity and approval after copying. A final
conditional completion update fences lease expiration during database writes.
A savepoint rolls back published rows if that final fence fails. Normal errors
roll back the transaction and remove only files created by that invocation;
existing files are never overwritten or removed. Empty private directories may
remain. SIGKILL/host failure can leave private orphan files. Retries refuse to
overwrite those files; orphan maintenance is not implemented in this block.

## Result history and limits

The block 2 result API accepts only asset, schema version and
`unknown | partial | complete`. It builds `result_json` from that status and
persisted frame metadata, with provider `none` and model NULL. Here status
describes the evidence result, not a semantic analysis. Empty manifests are
allowed. The API rejects caller-supplied labels, providers, correction identities,
and other unsupported fields.

Results are append-only and versioned by job/asset/schema/revision. The schema
prepares future human corrections through a scoped predecessor FK, next revision,
required author/date and exact preservation of the first original JSON across
the chain. There is no correction API yet. Direct SQL is a trusted administrative
boundary, not an alternative authorization interface.

Bounds: 64 approved assets, 256 frame descriptors per publication, index 1–64 per
asset, JPEG <=8 MiB and <=1280px, 64 result descriptors, lease 1–3600s. Version
identifiers are required metadata; no runtime/extractor is launched or selected
from them. This block adds no automatic quota billing, retention, worker service,
model validation, or deployment. All schema changes are additive/idempotent in
the local SQLite backend; no production database is modified by development.
