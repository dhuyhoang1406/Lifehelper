# Durable Document processing — Phase 5 Branches 3–5

Document Service uses persistent PostgreSQL jobs and its own transactional outbox.
No BullMQ, SQS deployment or paid provider is required. Branch 4 uses real bounded
extraction/chunking and stages EXTRACTED generations. Branch 5 queues local embeddings
from those stored chunks and activates READY only after complete indexing. See the
[extraction runbook](document-extraction.md) and [embedding runbook](document-embeddings.md).

## Lifecycle and fencing

Completion verifies actual S3 bytes outside the transaction. Its transaction then
commits UPLOADED metadata, one queued generation/job and one `document.uploaded` event.
Repeated/concurrent completion does not schedule duplicate work. The queued generation
is `processingGeneration + 1`; the document counter advances only at worker claim.

Workers claim with PostgreSQL SKIP LOCKED and lock Document before Job, consistently
with retry/delete/publication. Claim atomically sets PROCESSING, records
`document.processing.started`, increments attempt count and a monotonic fencing token,
and assigns an expiring lease. Replicas can claim different documents concurrently.

Processing reads the committed S3 version, then checks its size, MIME and SHA-256.
Stages prepare domain results outside DB transactions and must honor their AbortSignal;
they must not persist intermediate rows themselves. Only the fenced publisher validates
and atomically persists complete prepared chunks/vectors, activates READY and records
`document.processing.ready`. It checks owner/token/job/generation, deletion and DB lease
before writes and again before returning from the transaction. Expiry during publication
rolls back the results. Legacy unfenced writers cannot publish verified-source results.

Expired leases requeue on a bounded jittered schedule. A later claim increments the
fence; stale workers cannot publish or fail its attempt. Transient storage/timeouts
retry in the same generation. Permanent unsupported input, invalid results and
unavailable stages fail immediately. Terminal/exhausted failure atomically sets
job/generation/document FAILED and writes `document.processing.failed` with a safe code.
Repeated crashes count toward the same attempt budget. Delete cancels active jobs and
prevents resurrection. Completion requests never wait for the full pipeline; their
response may already reflect a fast worker claim/failure. Verified-source downloads
remain available for a nondeleted failed document.

## Status and manual retry

Metadata/list entries now include `processingError` and `retryEligible`.

```http
POST /documents/:id/retry-processing
Authorization: Bearer <Identity access token>
```

No body is required. Eligible terminal failures return 202 with
`{documentId,jobId,generation,status:"PENDING"}`. Retry creates a new generation with
a fresh bounded attempt budget; repeated/concurrent retry returns the same queued job.
The document stays FAILED until that generation is claimed. Cross-owner/deleted IDs
return 404; ineligible state/input returns 409 `DOCUMENT_RETRY_NOT_ELIGIBLE`.
Unsupported/unverified sources and invalid results are not declared retryable.
Retrying unavailable stages before installing them reports the same controlled failure;
calling upload-complete again does not restart processing.

## Validated configuration

Use the root Compose `.env` or service `.env`, retaining Branch 2's JWT/storage settings.

| Variable                                | Default | Bound / meaning                                        |
| --------------------------------------- | ------- | ------------------------------------------------------ |
| `DOCUMENT_WORKER_ENABLED`               | true    | false preserves queued jobs without polling            |
| `DOCUMENT_WORKER_CONCURRENCY`           | 2       | 1–8 per process                                        |
| `DOCUMENT_WORKER_POLL_MS`               | 1000    | 50–60000                                               |
| `DOCUMENT_WORKER_LEASE_MS`              | 60000   | 1000–900000; greater than processing timeout + 10000ms |
| `DOCUMENT_WORKER_SHUTDOWN_MS`           | 5000    | 100–30000                                              |
| `DOCUMENT_PROCESSING_TIMEOUT_MS`        | 30000   | 100–120000, source read + stages                       |
| `DOCUMENT_PROCESSING_MAX_ATTEMPTS`      | 3       | 1–10, including crashed claims                         |
| `DOCUMENT_PROCESSING_RETRY_BASE_MS`     | 500     | 10–60000                                               |
| `DOCUMENT_PROCESSING_RETRY_MAX_MS`      | 30000   | at least base; at most 300000                          |
| `DOCUMENT_PROCESSING_MAX_CHUNKS`        | 1000    | 1–2000 prepared chunks                                 |
| `DOCUMENT_PROCESSING_MAX_TEXT_CHARS`    | 1000000 | 1–5000000 prepared UTF-16 code units                   |
| `DOCUMENT_PROCESSING_MAX_VECTOR_VALUES` | 1048576 | 1–4000000 total prepared vector values                 |

Retry delays grow exponentially to their cap, with jitter between half and the full
delay. Source reads retain file/deadline/concurrency limits. Shutdown stops polling,
aborts work and waits up to the shutdown bound; unfinished leases survive restart.
An adapter ignoring abort keeps its local slot until it settles, and its late output
is discarded. Real parsers must implement bounded execution/cancellation in Branch 4.
Logs contain stable operation codes/job IDs, not bodies, vectors, URLs or raw errors.

## Migration and local test flow

Stop old workers before upgrading: the migration invalidates unfenced RUNNING leases
and schedules verified Branch 2 UPLOADED rows without jobs. Back up existing data and
point DATABASE_URL to the intended Document database:

```bash
docker compose stop document-service
pnpm --filter @lifehelper/document-service prisma:generate
pnpm --filter @lifehelper/document-service db:migrate
docker compose up -d --no-deps --build document-service
```

See [migration details](../database/document-migrations.md). No source version/checksum
is invented for legacy rows; queued legacy jobs without verified identity fail with
`DOCUMENT_SOURCE_MISMATCH`. The Document build disables incremental emit because Nest
deletes its output directory; repeated builds must include all runtime entry points.

Upload/complete a real file with the [upload walkthrough](document-upload.md), then
poll metadata. An enabled worker now stages real chunks for supported files and keeps the document
PROCESSING (generation EXTRACTED), without READY. Unsupported files fail explicitly. Disable the worker to inspect durable
queued work; enabling it resumes polling. Once real stages exist, eligible failed
documents can use the retry API.

## Outbox contracts

Events are `document.uploaded`, `document.processing.started` (one per claim),
`document.processing.failed` (terminal failure), `document.processing.extracted`
(Branch 4 staging) and `document.processing.ready`
(complete fenced publication). Version-1 envelopes contain id, type, version,
producer=document-service, correlationId=jobId, UTC occurredAt and payload fields
documentId/jobId/generation/attempt/optional safe errorCode. They omit owner details,
filenames, object keys/versions, checksums, text, vectors, signed URLs and provider data.

Rows remain in Document's outbox; no external relay or fictitious delivery marking is
added. PostgreSQL job polling dispatches local work. A transport adapter/ADR belongs
to the later messaging phase. HTTP request IDs remain in request logs; job IDs
correlate background lifecycle events.

## Verification and deferred work

Use migrated dedicated `_test`/`_ci` databases, never application data:

```bash
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch3_test' \
  pnpm --filter @lifehelper/document-service db:migrate
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch3_test' \
  pnpm --filter @lifehelper/document-service test:worker
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch3_test' \
  pnpm --filter @lifehelper/document-service test:persistence
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch3_test' \
  pnpm --filter @lifehelper/document-service test:storage
pnpm --filter @lifehelper/document-service test --runInBand
pnpm --filter @lifehelper/document-service test:e2e
pnpm --filter @lifehelper/document-service lint
pnpm --filter @lifehelper/document-service exec tsc --noEmit -p tsconfig.json
pnpm --filter @lifehelper/document-service build
pnpm --filter @lifehelper/document-service prisma:validate
```

Run worker/storage suites sequentially on a shared test database because claims are
global. CI does this. HTTP tests disable automatic polling and invoke work deterministically.
Tests cover duplicate work, competing claims, restart/expired lease recovery, stale
owner/token/generation, retry/delete races, bounded retries, unsupported/no-op results,
unfenced writes and lifecycle/outbox rollback. Two-dimensional vectors are fixtures,
not a production model choice. Upgrade and two-process restart smoke checks ran on
dedicated fixtures on 2026-10-02. Application databases/containers were not changed.
Community LocalStack anonymous denial remains explicitly skipped. Gemini review remains
an informational PR workflow; no local reviewer was configured.

Deferred: embeddings/model selection/index, retrieval/RAG,
Branch 8 cleanup/reprocessing/audit, external event relay, OCR, delivery, analytics,
Flutter screens and production deployment. No review report file is created.

Branch 5 splits one generation into durable extraction/indexing phases. Each phase has a bounded attempt budget; indexing retries reuse staged chunks. See [embedding processing and recovery](document-embeddings.md).
