bra# Document lifecycle, cleanup and audit — Phase 5 Branch 8

## Reprocess and active-generation policy

```http
POST /documents/:id/reprocess
Authorization: Bearer <accessToken>
x-idempotency-key: <new UUID for this operation>
```

The owner may explicitly reindex a READY document or reprocess an eligible recoverable
failure with committed immutable source bytes. Model-space mismatch is eligible for
explicit reindex after correcting configuration. Unsupported input remains a permanent
failure; source replacement is outside Phase 5. A valid UUID idempotency header is
required. A new key starts a new operation; retries of the same request reuse its key.

Response `202` is `{documentId,jobId,generation,status}`. The job status reflects the
current receipt (PENDING/RUNNING/SUCCEEDED/FAILED). The same key returns the same job
and generation even after completion; a different key during existing pending/running
work returns 409. A missing, foreign or deleted resource returns safe 404. Jobs and
receipts are service-local and serialized by the Document row lock plus SQL uniqueness.
The existing `/retry-processing` route remains available with its original eligibility.

Scheduling leaves the active generation unchanged. A claim advances processingGeneration
and sets PROCESSING; the prior COMPLETE generation remains readable until atomic
activation of the fully embedded replacement. If reindex fails, the preceding active
generation remains readable while metadata reports FAILED. Retrieval permits this only
when the active generation's source version/checksum still match the immutable committed
source. Nonready documents with no active generation are never searchable.

Query embedding space must still exactly match the stored space: old results are not
compared with incompatible query vectors when models/configuration change. Plan model
rollouts accordingly. Source chunk reads and downloads remain available during reindex;
after activation, old chunk/generation requests return 404. A RAG citation check racing
activation fails safely and the caller can retry the question with fresh sources.

## Deletion and durable cleanup

DELETE remains owner-authorized and now returns 204 idempotently for retained owned
tombstones. It immediately hides metadata/download/retrieval, cancels jobs, closes running
audit attempts and fences existing cleanup leases. No new processing can start. Physical
cleanup is asynchronous; a stale worker cannot reactivate deleted content.

A separate bounded maintenance worker uses persistent cleanup tasks with lease owner,
expiry, monotonically increasing fencing token and attempts. Crashed replicas are
recoverable. S3 calls run outside transactions. Only the current lease may commit cleanup
completion, derivative deletion and its outbox event. If S3 succeeds but the DB commit
fails, retrying the same deletion is safe. Partial S3 pages requeue without consuming the
failure retry budget; failures use bounded exponential backoff with jitter. Exhausted
work pauses with `DOCUMENT_CLEANUP_RETRY_EXHAUSTED` instead of being dropped. An owned
repeat DELETE rearms exhausted cleanup; operators can also rearm an orphan task safely
through the documented database operation below.

Versioned S3 cleanup removes both source versions and delete markers. For a live committed
document it removes extra versions while retaining the exact committed version; for a
deleted/expired document it removes all versions. Never treat deleting the latest version
or adding a delete marker as complete physical cleanup. The adapter checks per-object
DeleteObjects errors even when the HTTP status is 200. Calls, pages and response scope
are bounded; a kept version cannot pin pagination indefinitely.

A reusable upload POST can create later versions until expiry, including an upload begun
before expiry that finishes later. Cleanup waits through upload expiry plus a configurable
grace period, then periodically resweeps. An already-issued signed download URL can remain
usable until its expiry or physical source deletion; DELETE is not instant revocation of
that previously issued capability.

An expired PENDING_UPLOAD is soft-deleted by reconciliation and gets durable cleanup.
Inventory scans only the configured Document bucket's server-generated `users/.../documents/...`
namespace. Old keys without metadata get orphan cleanup tasks. Recent keys and unrelated
namespaces are ignored. A durable two-part S3 version cursor advances in bounded pages;
compare-and-set prevents slower replicas from rewinding it. If concurrent cleanup invalidates
a version marker, inventory resets to the beginning; transient storage errors preserve
the cursor rather than silently skipping work. Cleanup rechecks metadata
before deleting a queued orphan. Inventory also includes versions hidden by delete markers.

Historical AI messages/citation metadata remain readable in the owner's conversation;
reading a deleted source through Document APIs returns unavailable. Grounded chat always
retrieves fresh evidence. Historical grounded assistant content and document-tool exchanges are omitted from future
provider contexts, including normal chat, so a cached answer does not revive document
content as current evidence. This does not erase content already shown to the user.

## Audit, contracts and retention

Processing audit rows record document/job/generation/fencing identity, phase, status,
server UTC start/finish instants, monotonic processing duration when measured, and
whitelisted aggregate metrics. Metrics include chunk count, UTF-16 text length, estimated
input tokens, embedding value count and model/version/dimensions. Estimated tokens use the
existing chunk estimator; they are not claimed to be provider-billed usage. Crashed
attempts have unknown duration rather than an invented latency. Audits have no FK to source
content, so physical cleanup does not erase the independent short-term audit trail.

Logs/events/audits omit document bodies, vector arrays, object keys, version IDs, signed
URLs, credentials and filenames. Cleanup errors use fixed codes. The maintenance logger
never prints upstream errors or inventory cursors.

All envelopes remain version 1, with server UTC occurredAt, producer `document-service`,
aggregateType `document` and operation/job ID as correlationId:

| Event                         | Payload/meaning                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| document.uploaded             | Existing documentId/jobId/generation/attempt                                                                 |
| document.processing.started   | Existing start/retry event                                                                                   |
| document.processing.completed | Canonical baseline completion after atomic READY activation; adds whitelisted aggregate metrics              |
| document.processing.failed    | Existing sanitized errorCode                                                                                 |
| document.processing.extracted | Existing Branch 4 extension, now adds aggregate extraction metrics                                           |
| document.reprocess.requested  | New documented v1 scheduling event, once per new operation                                                   |
| document.deleted              | New documented v1 deletion event; expiry uses DOCUMENT_UPLOAD_EXPIRED; generation can be 0 before processing |
| document.cleanup.completed    | New documented v1 event after first successful physical/derivative cleanup of a deleted document             |

Branch 3–7 emitted `document.processing.ready`; this branch emits the baseline
`document.processing.completed` instead. Existing queued legacy envelopes are retained
unchanged; future consumers should accept legacy ready while draining historical queues.
No implemented event consumer currently depends on the legacy name. For the new deletion/cleanup
events, jobId and correlationId identify the cleanup task; processing/reprocess events
identify the processing job. The outbox schema
and envelope version are unchanged; newly documented event types and optional metric
fields are additive. Orphan tasks without a document retain their own cleanup status;
they do not fabricate document domain events.

Default retention runs in bounded batches:

- Inactive completed/failed generation chunks/vectors: 30 days. Active generations and
  pending/running work are protected under the same Document lock as processing/deletion.
- Generation/job metadata and reprocess idempotency receipts: retained while the Document
  exists; no document text is kept in these receipts.
- Finished processing audits: 30 days from startedAt; running attempts are protected
  until closed or observed expired. Successful orphan-task metadata: 30 days from creation.
- Owned deleted tombstones: purge after 30 days only after successful cleanup, with no
  active cleanup lease/error. Late orphan sources are still reconciled by inventory.
- Processed outbox events: 90 days after processedAt. Unprocessed events are never purged.
- AI conversation retention is unchanged; this service never edits ai_db.

## Configuration and migration

Migration `20261015000100_document_lifecycle_audit` adds job idempotency keys, upgrades
existing cleanup rows to leased tasks, and adds inventory cursor/audit tables. It preserves
existing tasks and all source rows. Only the Document database changes. Back up the intended
DB and apply before running the new Document service.

```bash
# DATABASE_URL must identify the intended Document database reachable from this shell.
pnpm --filter @lifehelper/document-service db:migrate
docker compose up -d --build document-service ai-service
```

The AI rebuild enables the historical-context safeguard; there is no new AI migration.

| Setting                                 |                                                    Default |
| --------------------------------------- | ---------------------------------------------------------: |
| DOCUMENT_MAINTENANCE_ENABLED            | true outside tests; false in NODE_ENV=test unless explicit |
| DOCUMENT_MAINTENANCE_POLL_MS            |                                                      30000 |
| DOCUMENT_MAINTENANCE_BATCH_SIZE         |                                                          4 |
| DOCUMENT_CLEANUP_LEASE_MS               |                                                      60000 |
| DOCUMENT_CLEANUP_TIMEOUT_MS             |                                                      15000 |
| DOCUMENT_CLEANUP_MAX_ATTEMPTS           |                                                          8 |
| DOCUMENT_CLEANUP_RETRY_BASE_MS / MAX_MS |                                              1000 / 300000 |
| DOCUMENT_CLEANUP_RESWEEP_MS             |                                                    3600000 |
| DOCUMENT_CLEANUP_GRACE_MS               |                                                     900000 |
| DOCUMENT_INVENTORY_PAGE_SIZE            |                                                        100 |
| DOCUMENT_CLEANUP_VERSION_BATCH_SIZE     |                                                        500 |
| DOCUMENT_RETENTION_BATCH_SIZE           |                                                        100 |
| DOCUMENT_AUDIT_RETENTION_DAYS           |                                                         30 |
| DOCUMENT_GENERATION_RETENTION_DAYS      |                                                         30 |
| DOCUMENT_TOMBSTONE_RETENTION_DAYS       |                                                         30 |
| DOCUMENT_OUTBOX_RETENTION_DAYS          |                                                         90 |

All values are validated. Cleanup lease must exceed operation timeout by more than 10s;
orphan grace must cover at least the configured maximum upload authorization duration.
Existing bounded AWS SDK timeouts/retries still apply inside the operation timeout.
Objects can remain physically present during this grace window, while new API reads are
already denied. NODE_ENV=test avoids background sweeps of shared test storage.

AWS compatibility follows the official [ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html)
and [DeleteObjects](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html) contracts.
A future production role needs s3:ListBucketVersions and s3:DeleteObjectVersion on the
dedicated private bucket, in addition to the existing upload/download permissions.

## Operations and verification

```sql
SELECT document_id, attempt_count, lease_expires_at, completed_at, error_code
FROM document_cleanup_tasks ORDER BY next_attempt_at;
SELECT document_id, generation, phase, status, duration_ms, metrics, error_code
FROM document_processing_audits ORDER BY started_at DESC LIMIT 30;
```

After resolving an orphan cleanup outage, rearm only the identified exhausted task:

```sql
UPDATE document_cleanup_tasks
SET attempt_count=0, error_code=NULL, next_attempt_at=clock_timestamp()
WHERE id='<reviewed-cleanup-task-uuid>' AND error_code='DOCUMENT_CLEANUP_RETRY_EXHAUSTED'
  AND lease_owner IS NULL;
```

Manual API checks: reprocess a READY file with a UUID header, repeat that key and verify
one job/generation; ask/read chunks while indexing and see the old generation; after
activation verify new citations. DELETE should immediately make source APIs unavailable.
With defaults, first physical cleanup waits until upload expiry + 15-minute grace, then
the next poll. Check all versions/delete markers, not just a normal bucket listing.

```bash
pnpm --filter @lifehelper/document-service prisma:generate
pnpm --filter @lifehelper/document-service prisma:validate
pnpm --filter @lifehelper/document-service lint
pnpm --filter @lifehelper/document-service exec tsc --noEmit
pnpm --filter @lifehelper/document-service test --runInBand
pnpm --filter @lifehelper/document-service build
pnpm --filter @lifehelper/ai-service test --runInBand
pnpm architecture:check
pnpm architecture:test
# Fresh migrated dedicated *_test / *_ci DB; LocalStack endpoint only.
pnpm --filter @lifehelper/document-service test:persistence
pnpm --filter @lifehelper/document-service test:worker
pnpm --filter @lifehelper/document-service test:storage
pnpm --filter @lifehelper/document-service test:e2e
# Separate AI, Productivity and Document test DBs:
pnpm --filter @lifehelper/ai-service test:persistence
pnpm --filter @lifehelper/ai-service test:e2e
pnpm --filter @lifehelper/ai-service test:workflow
```

Always drop newly created test databases in finally/trap on success and failure. Fixtures
clean their own S3 buckets/objects. Tests cover reprocess concurrency, active-generation
preservation, stale publishers/cleanup tokens, failed/exhausted cleanup, upload expiry,
orphan scope/cursors, all-version deletion, retained committed bytes, one-entry pagination,
retention protection, UTC audit and sensitive-field redaction. LocalStack Community's
anonymous-denial limitation remains unchanged and documented in the upload runbook.

Deferred to Branch 9: full Phase 5 release evaluation/closure evidence and final hardening.
OCR, source replacement, voice/vision, cloud embeddings, notification/analytics delivery
and production AWS deployment remain outside this branch.
