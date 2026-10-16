# Document RAG setup, verification and recovery

Phase 5 Branch 9 adds verification tooling, fixtures and operational instructions.
It does not add a public API, database migration, provider fallback or new event type.
Use [upload](document-upload.md), [retrieval](document-retrieval.md),
[RAG](ai-document-rag.md), [processing](document-processing.md) and
[lifecycle](document-lifecycle.md) for the authoritative contracts and limits.

## Local setup

Prerequisites: Node 22, the workspace pnpm version, Docker Compose, Python 3.11+ for
the verification runner, and enough RAM/disk for the explicitly selected models.
The Python scripts use only the standard library. Run commands from repository root.

```bash
pnpm install --frozen-lockfile
cp .env.example .env  # New checkout only; preserve an existing configured .env.
docker compose --profile document-embeddings up -d postgres redis localstack document-embeddings
docker compose exec document-embeddings ollama pull bge-m3:567m
```

Set `EMBEDDING_BASE_URL=http://document-embeddings:11434` for container execution.
Verify `/api/tags` reports the full BGE-M3 digest in the
[embedding ADR](../architecture/adr/001-document-embedding-space.md); changing the
configured digest to suppress a mismatch is not a recovery procedure. The PostgreSQL
image in Compose supports pgvector. Apply each service's migrations to its own DB;
Document migrations create/validate the vector extension.

```bash
pnpm --filter @lifehelper/document-service prisma:generate
pnpm --filter @lifehelper/ai-service prisma:generate
# Set these secret URLs in your shell to the intended service DBs.
# The guards prevent accidentally reusing one DATABASE_URL for both services.
DATABASE_URL="${DOCUMENT_DATABASE_URL:?Set intended Document database URL}" pnpm --filter @lifehelper/document-service db:migrate
DATABASE_URL="${AI_DATABASE_URL:?Set intended AI database URL}" pnpm --filter @lifehelper/ai-service db:migrate
pnpm --filter @lifehelper/document-service build
pnpm --filter @lifehelper/ai-service build
docker compose up -d --build --no-deps document-service ai-service
```

For host migration commands, Compose PostgreSQL is at `localhost:55432`; inside the
Compose network it is `postgres:5432`. Do not put the AI DB URL in Document configuration.
Never use `db:reset` on an application DB. A fresh Compose PostgreSQL provisions the
service databases through its existing init scripts. Existing volumes do not rerun init.
The private bucket bootstrap/config checks are documented in the upload runbook;
versioning must be enabled before upload and all public-access-block flags must be true.
LocalStack Community does not fully enforce S3 authorization. Its host port is bound
to loopback; successful local tests do not prove anonymous denial on production S3.

Generation can use existing Cloudflare free-quota configuration or a local Ollama chat
model. BGE-M3 is an embedding model and cannot replace a chat model. To try the small
local evaluation model without changing the application provider:

```bash
docker compose exec document-embeddings ollama pull qwen3:1.7b
```

This Qwen command reproduces the local evaluation, including its documented failures;
it is not a qualified model recommendation. A small model is not a quality guarantee.
The model volume persists.
No script automatically pulls models or enables a paid provider. The runner reuses
only model/provider settings from the existing local service containers and overrides
all database URLs, JWT credentials, bucket names and maintenance flags for isolation.
It launches additional host processes on ephemeral loopback ports, leaving application
containers/configuration/data unchanged. Local generation requires explicit CLI options.

Official references checked on 2026-10-15:
[Ollama embed](https://docs.ollama.com/api/embed),
[model pull](https://docs.ollama.com/api/pull),
[chat JSON schema and thinking options](https://docs.ollama.com/api/chat),
[Qwen3 1.7B distribution/license](https://ollama.com/library/qwen3:1.7b),
[pgvector exact cosine](https://github.com/pgvector/pgvector),
[LocalStack S3](https://docs.localstack.cloud/aws/services/s3/).
Use `truncate:false` for embeddings; install and verify the pinned model before serving.

## Environment and secrets

Root/service `.env.example` files plus Joi validation define the complete current
configuration. Do not copy secrets into command arguments, screenshots or benchmark
reports. These groups explain the flags used by the verification/demo:

| Variables                                                                                            | Secret?            | Purpose                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `DATABASE_URL`, `AI_DATABASE_URL`, `DOCUMENT_DATABASE_URL`, verification `PRODUCTIVITY_DATABASE_URL` | Yes                | Service-owned DB credentials; never reuse app DBs for tests                  |
| `JWT_ACCESS_SECRET`                                                                                  | Yes                | Shared verification of Identity access tokens; test runner generates its own |
| `JWT_ISSUER`, `JWT_AUDIENCE`                                                                         | No                 | Must match Identity outside isolated tests                                   |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                                                         | Yes                | Storage credentials; local test values are not production credentials        |
| `AWS_ENDPOINT_URL`, `AWS_REGION`, `DOCUMENT_S3_PUBLIC_ENDPOINT`                                      | No                 | Endpoint/region; host and container addresses differ                         |
| `DOCUMENT_S3_BUCKET`                                                                                 | No                 | Private versioned bucket owned by Document Service                           |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_MODEL_VERSION`, `EMBEDDING_DIMENSIONS`           | No                 | Compatible embedding space, separate from generation                         |
| `EMBEDDING_BASE_URL`, `EMBEDDING_TIMEOUT_MS`, `EMBEDDING_MAX_ATTEMPTS`                               | No                 | Private embedding origin and bounded requests                                |
| `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS`                                            | No                 | Existing generation provider; no paid fallback                               |
| `CLOUDFLARE_API_TOKEN`                                                                               | Yes                | Workers AI authorization for generation/embedding                            |
| `CLOUDFLARE_ACCOUNT_ID`                                                                              | Account identifier | Keep out of public evidence                                                  |
| `DOCUMENT_RETRIEVAL_MIN_SIMILARITY`                                                                  | No                 | Corpus-specific threshold (0.55 baseline), not a probability                 |
| `AI_RAG_*`                                                                                           | No                 | Evidence/output/call/summary coverage budgets; independent of short chat     |
| `DOCUMENT_WORKER_*`, `DOCUMENT_PROCESSING_*`, `DOCUMENT_PARSER_*`                                    | No                 | Concurrency, leases, bounded processing and retries                          |
| `DOCUMENT_MAINTENANCE_*`, `DOCUMENT_CLEANUP_*`, `DOCUMENT_*_RETENTION_DAYS`                          | No                 | Cleanup, reconciliation and retention                                        |

`fake` embeddings are test-only. CI does not download models or call real inference.

## Repeatable verification

```bash
pnpm architecture:check
pnpm architecture:test
pnpm lint
pnpm typecheck
pnpm --filter @lifehelper/document-service exec tsc -p test/tsconfig.json
pnpm test:document-rag-tooling
pnpm --filter @lifehelper/document-service test --runInBand
pnpm --filter @lifehelper/ai-service test --runInBand
pnpm verify:document-rag --mode regression --report /tmp/phase5-regression.json
pnpm verify:document-rag --mode real --report /tmp/phase5-cloudflare.json
```

Real mode follows the running Document container's configured embedding provider and
uses configured Cloudflare generation by default. To explicitly test cloud embeddings:

```bash
pnpm verify:document-rag --mode real --embedding-provider cloudflare \
  --report /tmp/phase5-all-cloudflare.json
```

Cloud embedding configuration and reindexing are documented in
[ADR 002](../architecture/adr/002-cloudflare-document-embeddings.md). When using that path,
skip the optional Ollama startup/model-pull steps; no local inference container is required.
Cloud provider quota/timeout/authorization behavior is exercised with controlled adapter
responses in deterministic tests; the real runner does not deliberately exhaust an account.
For local embeddings, explicitly pass `--embedding-provider ollama`.
For fully local generation, get the current private container IP for this host-only
verification process; do not hardcode it into application configuration:

```bash
EMBEDDING_HOST=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(docker compose ps -q document-embeddings)")
pnpm verify:document-rag --mode real --embedding-provider ollama \
  --generation-provider ollama --generation-model qwen3:1.7b \
  --generation-url "http://${EMBEDDING_HOST}:11434" \
  --report /tmp/phase5-local.json
```

Container IP access is Linux-local; use a reachable host Ollama URL on other platforms.
Optional `--embedding-url` selects a reachable local embedding server. The helper
currently targets the repository's default Compose container names and ports;
`VERIFY_POSTGRES_CONTAINER`, `VERIFY_LOCALSTACK_CONTAINER`, `VERIFY_POSTGRES_PORT`
override the database/storage handles. Default LocalStack and Redis host ports remain
4566 and 56379. Build both services before running real mode.

Each run creates UUID-named `rag_<run>_<service>_test` databases. Real mode also creates
a UUID-named versioned private bucket, including actual Vietnamese text-PDF bytes.
Cleanup stops only child processes and deletes only resources whose creation succeeded
in that run. Exceptions/SIGTERM trigger `finally`; SIGKILL/power loss cannot. Never delete
all `*_test` databases as a substitute. If cleanup fails, the report identifies the run
ID; inspect exactly those owned resources before operator cleanup. A failed CREATE
never registers an existing database as owned.

Reports contain fixture labels, synthetic generated answers, model identities,
configuration, source-validation results and nearest-rank p50/p95 with sample counts.
No real user documents, credentials, signed URLs or vectors are included. Generation
metrics count individual provider calls (including repairs/summary synthesis); total
chat time includes retrieval, application processing and persistence. Extraction and
embedding metrics measure port calls; READY wall time additionally includes worker
polling, queueing, SQL and source reads. Cold-start effects are retained and disclosed.
Anchor checks do not prove entailment. Review every synthetic answer against its
fixture and record support/unsupported claims separately from citation membership.

## API smoke flow

Authorize Swagger using a current Identity access token. For a new real file:

1. `POST /documents/upload-url` with filename, MIME, exact byte size and optional SHA-256.
2. POST multipart `upload.fields` plus `file` to the returned `upload.url` before expiry.
3. `POST /documents/{id}/upload-complete`, then poll `GET /documents/{id}` for `READY`.
4. `POST /internal/documents/search` with `{ "query":"Nhân viên có bao nhiêu ngày phép năm?", "topK":3, "documentIds":["<id>"] }`.
5. `POST /ai/chat` with `{ "prompt":"Nhân viên có bao nhiêu ngày phép năm?", "documentScope": {"mode":"search", "documentIds":["<id>"]} }`.
6. Repeat with `mode:"summarize"`; inspect `documentCoverage.partial` and persisted citations.
7. Ask an absent fact. Expect insufficient information, not an invented grounded answer.
8. `POST /documents/{id}/reprocess` with a new UUID `x-idempotency-key`; repeat the same key
   to verify the same job/generation. Wait for the new active generation, not just an old `READY` status.
9. Delete only a disposable fixture; new metadata/download/search/summary reads must fail safely.

A presigned URL cannot be revoked instantly by soft deletion. Physical cleanup waits for
upload expiry/grace and retries independently. Run the controlled automated race tests
instead of killing workers or resetting storage holding real documents.

## Error and recovery decisions

| Symptom/code                                                                | Action                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOCUMENT_OBJECT_MISSING`                                                   | Exact committed S3 version is absent. A DB-only restore or recreated ephemeral LocalStack can leave metadata/vectors intact. Inspect version history and cleanup audit; do not assume cleanup caused deletion. Retry alone cannot restore bytes. Restore the exact backed-up object version with compatible metadata, or upload as a new document. Never repoint immutable source identity at unrelated bytes. |
| `DOCUMENT_EMBEDDING_UNAVAILABLE`, `_TIMEOUT`, `_QUOTA`                      | Restore endpoint/capacity, observe bounded persisted retries. When exhausted, use owner retry/reprocess if eligible. Never change to fake embeddings in runtime.                                                                                                                                                                                                                                               |
| `DOCUMENT_EMBEDDING_MODEL_MISMATCH`                                         | Verify tag/digest/dimensions/input policy. Roll back config to the original space or explicitly reindex with the selected new space. Never relabel old vectors.                                                                                                                                                                                                                                                |
| `DOCUMENT_PDF_NO_TEXT`, `_ENCRYPTED`, `_INVALID`, text/file resource limits | Unsupported/permanent input. Supply supported UTF-8 TXT/MD or a text PDF; OCR is deferred.                                                                                                                                                                                                                                                                                                                     |
| `DOCUMENT_IDEMPOTENCY_KEY_INVALID`                                          | Send a canonical UUID header; reuse it only for the same reprocess intent.                                                                                                                                                                                                                                                                                                                                     |
| `DOCUMENT_REPROCESS_NOT_ELIGIBLE`                                           | Check active job/state/source identity; do not force SQL status changes.                                                                                                                                                                                                                                                                                                                                       |
| `DOCUMENT_CLEANUP_RETRY_EXHAUSTED`                                          | Restore S3 permissions/availability, inspect the specific task, and follow the lifecycle runbook's targeted rearm procedure.                                                                                                                                                                                                                                                                                   |
| AI provider unavailable/quota                                               | Controlled provider error; no paid fallback or fabricated persisted assistant success. Retry later within the provider policy.                                                                                                                                                                                                                                                                                 |
| Worker crash                                                                | Wait for lease recovery; fencing rejects stale commits. Do not manually set READY or duplicate chunks.                                                                                                                                                                                                                                                                                                         |

## Migration rollback and recovery

There is no Branch 9 SQL migration. AI build now disables incremental output caching
because Nest deletes `dist`; repeat builds must emit complete executable output.
Swagger retrieval numeric fields are explicitly typed; API validation/ranges are unchanged.

For upgrades, snapshot **each service DB separately** and all corresponding versioned
private objects/configuration before migrations; record migration names, model digests
and application image SHAs. Stop Document processing/maintenance workers while restoring
or reconciling snapshots. Test restores on isolated DB/buckets, never by resetting app data.
Prisma migrations are forward-only here; do not edit applied migration checksums or mark
an applied migration rolled back without restoring/reconciling the actual schema.

If only application code is faulty and the prior build supports the additive schema,
redeploy that image with compatible embedding config. Otherwise restore the matching DB
snapshot and source object versions as a coordinated operator operation, or deploy a
reviewed forward repair. Object storage and PostgreSQL are not one transaction: a DB
snapshot alone cannot recover deleted source bytes. After recovery verify READY/vector
cardinality, ownership, new writes, job leases, outbox, and citation reads before restarting
workers. Keep unprocessed outbox events and successful idempotency receipts.

Model changes: old compatible active generation can remain readable during same-source
reindex, but a service configured for a different embedding space must not compare old
vectors. Reindex to the new space and activate atomically; during rollout incompatible
search may return empty. This version has one configured query space and does not promise
zero-downtime dual-model search. Historical citations identify immutable generations;
retention/deletion can make their source unavailable.

## Scope and release state

The [evidence report](../verification/phase-5-document-rag.md) records actual runs and gaps.
No release tag or final merge is performed by this branch. Human review/merge remains
outside Codex authority. Gemini review is development tooling through the existing PR
workflow, not a runtime dependency or a reason to change providers. OCR, scan-only PDF,
Voice/Vision, notification delivery, analytics, full Flutter screens and production AWS
deployment remain deferred. Confirmation/authorization/idempotency for Productivity writes
remain Phase 4 responsibilities even when a user explicitly asks for an action from a document.
