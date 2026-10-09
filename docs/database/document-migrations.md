# Document persistence — Phase 5

Document Service owns `lifehelper_document` (the repository name for the spec's
`document_db`). Prisma and pgvector access stay inside this service. Owner IDs have
no foreign keys to Identity; AI will integrate through authorized APIs in later branches.

## Migration and upgrade

Use a PostgreSQL server with pgvector installed (the existing Compose/CI image):

```bash
pnpm --filter @lifehelper/document-service prisma:generate
pnpm --filter @lifehelper/document-service prisma:validate
pnpm --filter @lifehelper/document-service db:migrate
```

`DATABASE_URL` must point to the intended Document database. Back up existing data
before upgrading. The initial Phase 0 migration already created an unconstrained
vector column. This branch preserves those vectors, makes the column nullable for
metadata-only staging, infers legacy dimensions with `vector_dims`, and records
`modelVersion=legacy`. No model-specific dimension or vector search index is chosen;
that decision belongs to Branch 5.

The new migration adds generations, active-generation pointers, optimistic revision,
durable processing jobs, source locator columns and model metadata. Existing chunks
are assigned generation 1. The unique chunk key becomes
`(document_id, generation, chunk_index)`; object keys remain globally unique.
The active-generation foreign key and all chunk/job relations stay within Document.

Preflight legacy data for blank chunks, invalid checksums, free-text processing
errors and incomplete READY documents. Locators cannot be inferred safely from
arbitrary legacy JSON. Legacy READY documents must be explicitly reconciled for
reprocessing before upgrade; otherwise the migration refuses them rather than
silently claiming they are searchable. Use an audited maintenance procedure to
return those documents to UPLOADED and clear obsolete errors after preserving a
backup. Do not reset a database containing real files or metadata.

All migration statements are in one transaction. On failure PostgreSQL rolls back
schema/data changes. Fix the stated legacy-data issue, inspect `_prisma_migrations`,
then mark the failed migration rolled back using `prisma migrate resolve
--rolled-back 20261001000100_document_generations_jobs` before retrying deploy.
Do not mark a failed migration applied. For rollback after a successful deployment,
prefer a reviewed forward migration or restore a tested backup: generation-aware
chunks cannot safely be collapsed to the old unique key without checking conflicts.

## Lifecycle and concurrency

New documents start PENDING_UPLOAD. Legal transitions are:

- PENDING_UPLOAD → UPLOADED or DELETED.
- UPLOADED → PROCESSING, FAILED or DELETED.
- PROCESSING → READY, FAILED or DELETED.
- READY/FAILED → PROCESSING or DELETED.
- DELETED is terminal.

Repositories require owner context and exclude deleted documents for normal reads,
including chunk, generation, job and embedding metadata reads. Collections have
bounded limits. `insert` only creates pending documents. `save(entity,
expectedRevision)` performs compare-and-set, returns false for a stale write and
increments the persisted revision; callers must reload before the next write.
Owner/object identity is immutable at the database boundary.

`startGeneration` atomically claims an eligible owner-scoped document using its
revision, increments generation, inserts a generation and one uniquely constrained
PENDING job. Duplicate starts cannot create two jobs. Failure to insert the job rolls
back the document transition. External calls never run in these transactions.

`activateGeneration` locks the owner-scoped document and requires the current
processing revision/generation. Every contiguous chunk (starting at zero) must have
a token count, locator and non-null vector. It marks the generation COMPLETE and
document READY together. A database lifecycle trigger independently checks READY
completeness. Metadata-only embeddings cannot make a document searchable. Reprocessing
retains the previous active-generation pointer, but retrieval must filter READY status
and use only that pointer when implemented in Branch 6. Deletion clears it.

Jobs persist attempt count, next attempt, lease owner/expiry and safe error code;
constraints require both lease fields only in RUNNING state. Errors are stable
uppercase codes, never raw parser/provider output. Job scheduling, claim/recovery
adapters and outbox emission are deferred to Branch 3. Do not manually retry a live
job by changing only its status; future recovery must coordinate document generation,
job lease and audit changes transactionally. This branch starts no worker.

## Verification

Use a dedicated database ending in `_test` or `_ci`, never the application database.
Apply migrations before the persistence suite:

```bash
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch1_test' \
  pnpm --filter @lifehelper/document-service db:migrate
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch1_test' \
  pnpm --filter @lifehelper/document-service test:persistence
pnpm --filter @lifehelper/document-service lint
pnpm --filter @lifehelper/document-service exec tsc --noEmit -p tsconfig.json
pnpm --filter @lifehelper/document-service test --runInBand
pnpm --filter @lifehelper/document-service test:e2e
pnpm --filter @lifehelper/document-service build
```

Tests use synthetic owners and remove only their fixtures. Timestamps are
TIMESTAMPTZ and round-trip to ISO-8601 UTC; no user timezone or model timestamps
are used for processing. The suite covers owner isolation, concurrent starts,
transaction rollback, generation uniqueness, constraints, mapper round trips,
activation and deletion. Synthetic two-dimensional vectors in a DB test are fixtures,
not a choice of production embedding dimensions.

Deferred after Branch 1: upload/download/S3 verification, parsing/chunking, actual worker/recovery,
embedding HTTP adapters/indexes, retrieval/citations, AI document tools and RAG,
lifecycle cleanup/outbox, OCR, delivery, analytics and Flutter screens. No public
API/event contract is added by Branch 1; existing health routes remain unchanged.

## Branch 2 private upload migration

`20261001000200_document_private_upload` adds nullable upload expiry, expected
checksum and committed S3 version columns, plus `document_cleanup_tasks`. All foreign
keys remain inside Document's database. Existing rows retain null upload fields;
the migration does not trust an old checksum or infer an S3 version. Legacy pending
uploads must be recreated through the new authorization API; legacy uploaded rows
without a verified version cannot receive a download URL until explicitly reconciled.

The migration runs transactionally and adds immutability guards for declared upload
size/type/checksum/expiry and committed version/checksum. Owner and object path remain
protected by Branch 1's guard. A failed migration can be marked rolled back with
`prisma migrate resolve --rolled-back 20261001000200_document_private_upload` after
inspecting the failure and correcting its cause. Do not mark it applied on failure.

New upload reservations insert metadata and a cleanup task in one transaction under
a per-owner PostgreSQL advisory lock. Failed signing hides the reservation and releases
logical quota. Completion changes PENDING_UPLOAD to UPLOADED exactly once with revision
and expiry checks. Branch 2 creates no job/event; Branch 3 adds atomic scheduling.

Cleanup tasks schedule reconciliation at upload expiry. Deletion hides metadata and
clears the active generation immediately, but final cleanup is scheduled no earlier
than authorization expiry: the POST can still be reused before then. Branch 8 must
re-read current document state, preserve the committed version of a live document,
remove uncommitted versions, and remove all versions/delete markers for expired
pending or deleted documents. It must coordinate with concurrent completion and
retry failed cleanup. This branch persists that schedule and starts no cleanup worker.

See [upload API](../api/document-upload.md) for versioned storage provisioning,
local verification and the Community LocalStack security limitation.

## Branch 3 processing leases and recovery

`20261002000100_document_processing_leases` adds a nonnegative job fencing token
and requires a positive token on RUNNING jobs. Stop old workers before migration;
unfenced RUNNING leases become PENDING with cleared lease fields and a sanitized
recovery code. Attempt count is retained. The migration transaction also schedules
missing generation/jobs and version-1 uploaded events for verified, nondeleted
UPLOADED rows from Branch 2. It never fabricates a version or checksum. Queued
legacy jobs with unverified sources fail explicitly rather than hanging PROCESSING.

Completion now atomically persists source identity, UPLOADED state, one generation/job
and event. Worker claim/recovery/publication/failure and owner-authorized retry use
Document-first locks, leases and monotonic fencing tokens. Publication writes prepared
domain results only after its fence matches; failure/deletion/retry cannot activate
stale work. The old unfenced generation/chunk/embedding writers remain available only
for legacy unverified fixtures; verified sources require the fenced publisher.

The migration is transactional. Inspect/correct a failed deployment, then resolve
`--rolled-back 20261002000100_document_processing_leases` before retrying; do not mark
a failed migration applied. A successful rollback needs a reviewed forward migration
or backup restore: dropping the fence while workers run would invalidate its guarantee.
No database reset is needed. Clean deployment and Branch 2 existing-data upgrade were
tested on dedicated fixture databases, including legacy lease invalidation and UTC
event identity. See the [worker runbook](../api/document-processing.md) for commands,
configuration, retry semantics, unavailable stages and deferred relay/cleanup.

## Branch 4 extraction staging

`20261008000100_document_extraction_staging` adds the EXTRACTED generation state,
processing version, immutable source checksum/version and extractedAt (TIMESTAMPTZ).
New constraints require complete identity and positive chunk count for staged rows.
Existing generations remain unchanged; no active generation or READY state is assigned.
Stop old workers, back up Document data, generate the client and apply migrations before
rebuilding the service. See [extraction runbook](../api/document-extraction.md).

## Branch 5 embedding-space migration

`20261009000100_document_embedding_index` keeps the baseline pgvector extension/vector
column and adds model/digest/dimensions/settings on generations. Existing COMPLETE
vectors are backfilled with their own homogeneous identity; they are never labeled as
BGE-M3. A mixed/missing legacy space refuses upgrade. A cosine vector must be nonzero;
pgvector itself rejects NaN/infinite vector values and existing checks enforce dimensions.
READY validation now requires every chunk/vector to match generation embedding metadata.

The migration resumes nondeleted Branch 4 EXTRACTED/SUCCEEDED jobs as PENDING, resetting
attempt count for the indexing phase while retaining the fencing token. It preserves
chunk IDs, source checksums, locators and extraction versions. Clean migration and an
upgrade fixture with both staged jobs and historical READY vectors were verified on
real pgvector PostgreSQL. Old workers must be stopped before deployment; see the
[embedding runbook](../api/document-embeddings.md). Exact cosine search requires no
approximate index. Retrieval HTTP, administration/reindex and cleanup remain deferred.
