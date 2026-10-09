# Document embeddings and vector indexing — Phase 5 Branch 5

Supported uploads now progress through extraction and real local embeddings to READY.
READY means every staged chunk has a valid vector in one recorded embedding space;
activation, job success and `document.processing.ready` commit atomically. Existing
upload/metadata/download/retry routes and event envelope v1 are preserved. Search HTTP
and AI document tools remain Branches 6–7.

## Processing and recovery

The extraction attempt saves chunks/source identity as EXTRACTED and queues the same
job for indexing, resetting its bounded attempt budget for this phase. The next fenced
claim loads those stored chunks without rereading S3 or repeating extraction. Calls to
Ollama happen outside transactions. All batch results remain transient until the entire
generation validates and publishes atomically; a partial batch failure cannot publish
partial vectors or READY. A transient embedding failure retries the same staged chunks.
Lease recovery retains them and increments the fencing token. Terminal failure marks
the generation/document FAILED; an owner-authorized manual retry starts a new generation.

The shared job deadline bounds each claimed phase, including storage/extraction or
embedding batches. Parser and embedding calls retain shorter separate deadlines.
Shutdown propagates cancellation. Current generation, deletion, ownership/token and
lease expiry are rechecked during publication, including a final database-clock check.
Chunks must exactly match the staged IDs/content/locators. UTC database timestamps are
used for stored vectors and lifecycle events; model responses never set audit time.
Bodies, vectors, provider errors and private URLs are excluded from events and logs.

## Configuration

Generation provider settings are independent. See [model selection ADR](../architecture/adr/001-document-embedding-space.md).

| Variable                              | Default                | Meaning                                                                           |
| ------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| EMBEDDING_PROVIDER                    | ollama                 | fake is permitted only for tests                                                  |
| EMBEDDING_MODEL                       | bge-m3:567m            | exact local tag                                                                   |
| EMBEDDING_MODEL_VERSION               | ADR manifest digest    | full 64-character SHA-256 manifest digest                                         |
| EMBEDDING_BASE_URL                    | http://localhost:11434 | origin-only HTTP(S), no credentials/path/query; Compose uses host.docker.internal |
| EMBEDDING_DIMENSIONS                  | 1024                   | 1–16000, must equal real model output                                             |
| EMBEDDING_BATCH_SIZE                  | 8                      | 1–32 inputs, sequential batches per job                                           |
| EMBEDDING_MAX_INPUT_TOKENS            | 8192                   | conservative input estimate and requested model context, no silent truncation     |
| EMBEDDING_TIMEOUT_MS                  | 10000                  | 100–120000, less than processing timeout; includes response body                  |
| EMBEDDING_MAX_ATTEMPTS                | 2                      | 1–3 bounded retries for transient HTTP/network/timeout failures                   |
| DOCUMENT_PROCESSING_MAX_VECTOR_VALUES | 1048576                | must fit max chunks × dimensions; upper bound 4000000                             |

Timeout/unavailable/quota errors are transient; invalid vectors, incompatible model and
input limits are permanent. All failures are normalized `DOCUMENT_EMBEDDING_*` codes.
The worker has its own bounded persisted retry policy. No model is pulled automatically
by the application and no runtime provider fallback occurs.

Start local Ollama, run `ollama pull bge-m3:567m`, and inspect `/api/tags` to verify the
full digest. If a newer tag has a different digest, do not casually update the version:
review model selection and plan reindexing first. The application refuses mismatches.
Set a base URL reachable from the service (localhost for host execution;
host.docker.internal for Docker). Warm the model or raise embedding/job/lease timeouts
together within validated bounds on slow CPU hosts.

For an all-Docker local setup, the optional profile runs Ollama on the private Compose
network without publishing its API port:

```bash
docker compose --profile document-embeddings up -d document-embeddings
docker compose exec document-embeddings ollama pull bge-m3:567m
# Set EMBEDDING_BASE_URL=http://document-embeddings:11434 in the root .env.
# Then rebuild/start document-service after the migration below.
```

The model volume survives container replacement. The profile is optional and does not
change the host-Ollama default or CI; no model download occurs during normal startup.

## Upgrade and manual verification

Use the existing pgvector PostgreSQL image; back up the intended Document DB and stop
old workers before upgrading. Never reset a database holding real documents.

```bash
docker compose stop document-service
pnpm --filter @lifehelper/document-service prisma:generate
# DATABASE_URL must point to the intended Document database reachable from this shell.
pnpm --filter @lifehelper/document-service db:migrate
docker compose up -d --no-deps --build document-service
```

The migration resumes Branch 4 SUCCEEDED/EXTRACTED jobs as PENDING with a fresh indexing
budget. Existing compatible COMPLETE vectors retain their original identity; incompatible
legacy COMPLETE spaces cause migration failure and require explicit reconciliation.
The variable-dimension vector column remains; no approximate index is created.

Follow the [upload walkthrough](document-upload.md). Upload actual TXT/MD/text-PDF bytes,
call upload-complete, then poll metadata for READY. Unsupported image/encrypted PDFs
continue to fail explicitly. Inspect the Document database:

```sql
SELECT status,active_generation,processing_error FROM documents WHERE id='<UUID>';
SELECT status,chunk_count,embedding_model,embedding_version,embedding_dimensions,
       processing_version,embedding_settings,completed_at
FROM document_generations WHERE document_id='<UUID>';
SELECT c.chunk_index,e.embedding_model,e.model_version,e.dimensions,
       vector_dims(e.embedding),vector_norm(e.embedding)
FROM document_chunks c JOIN document_embeddings e ON e.chunk_id=c.id
WHERE c.document_id='<UUID>' ORDER BY c.generation,c.chunk_index;
```

## Verification

Normal CI invokes deterministic unit, real PostgreSQL persistence/worker, LocalStack
storage and E2E suites. It requires no Ollama/API credentials or model downloads.
For semantic evaluation, build first, migrate a dedicated *_test database, and export
the normal Document test JWT/storage settings plus real embedding settings:

```bash
pnpm --filter @lifehelper/document-service build
# DATABASE_URL: migrated dedicated *_test DB; LocalStack S3 endpoint must be local.
# NODE_ENV=test; DOCUMENT_WORKER_ENABLED=false; EMBEDDING_PROVIDER=ollama.
# JWT/storage settings are required as in the normal service configuration.
pnpm --filter @lifehelper/document-service test:embedding:smoke
```

The opt-in smoke creates its own private versioned bucket and test-owned document
fixtures, uploads real files, indexes them through the worker, checks top-1 retrieval,
then removes its documents/objects/bucket. It does not touch application documents.
A small eight-query fixture is not a production quality guarantee. Community LocalStack's
anonymous access-denial test remains skipped as recorded in the upload runbook.

Deferred: retrieval/citation HTTP APIs, AI grounded answers, approximate indexes,
production deployment, OCR, reindex administration and full lifecycle cleanup.
