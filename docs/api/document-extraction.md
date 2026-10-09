# Document extraction and chunking — Phase 5 Branch 4

Upload/completion endpoints stay the same. An enabled durable worker reads the committed
S3 version, verifies its identity, extracts text and atomically stages chunks. TXT and
Markdown are UTF-8 plain text; Markdown HTML/code is never executed. PDF extraction uses
pinned PDF.js 6.4.299 in a separate Node worker thread, with page/text/expansion bounds,
a deadline and a V8 heap limit. No arbitrary URL is accepted or fetched. Worker stdout
and stderr are discarded so parser diagnostics cannot leak document content into logs.
PDF font/page reading order can differ from visual order in complex multi-column files;
this branch does not perform layout reconstruction or OCR.

## State and persistence

```text
Document:   PENDING_UPLOAD → UPLOADED → PROCESSING
Generation: PROCESSING → EXTRACTED
Job:        PENDING → RUNNING → SUCCEEDED (extraction stage only)
```

`EXTRACTED` is a generation state, not a new HTTP document status. The document remains
PROCESSING with `activeGeneration=null`; no vectors are invented and no READY event is
emitted. `extractedAt` uses the database clock and TIMESTAMPTZ/UTC. Generation records
preserve processingVersion, SHA-256 and immutable S3 version for the committed source.
Chunks preserve index, content, token estimate and physical line/page ranges. Chunk IDs
and timestamps vary by attempt; normalized content, ordering, estimates and locators
are reproducible for the same bytes and processing settings.

Staging rechecks document/generation, lease owner/token, source identity and expiry
inside the transaction. Chunks, generation, successful stage job and the sanitized
`document.processing.extracted` outbox event commit together. The event uses the same
v1 document/job/generation/attempt envelope as Branch 3 and excludes bodies, filenames,
checksums, object versions and vectors. Stale/deleted workers cannot stage; expiry or
outbox failure rolls back the entire operation. Delete also invalidates EXTRACTED
staging. Search stays deferred until READY exists in Branch 5.

The extraction-only job is not polled again. Branch 5 must explicitly resume EXTRACTED
generations for embedding under a new fenced attempt; it must not silently treat this
stage's SUCCEEDED job as a completed searchable document. Branch 3 failed rows can be
retried through the existing authorized `retry-processing` API. Upload completion does
not automatically retry an old failed generation.

## Normalization, locators and token budget

UTF-8 decoding is strict; BOM is removed, CRLF/CR become LF and each physical line is
normalized to Unicode NFC. Blank lines retain their original line numbers. Horizontal
whitespace and Markdown syntax remain plain text. PDF.js text items are grouped into
lines using their page coordinates and EOL signals, with real 1-based page numbers.
Pages with no text are preserved as boundaries; an entirely image-only/empty PDF fails.

The estimator is `utf8-byte-upper-bound-v1`: each UTF-8 byte counts as one conservative
budget unit for byte-level tokenizers. It is not a model tokenizer and is deliberately
larger than many real token counts. For example `Việt` has four Unicode code points
but an estimate of six; an emoji estimates four. Branch 5 must enforce the selected
embedding model's actual input limits independently.

Chunking greedily fits this budget and prefers blank-line paragraph boundaries. Suffix
overlap is bounded by the configured estimate; whole word fragments are reused when
possible, so actual overlap may be smaller than requested. Oversize words split at
Unicode code points. Chunks reference only their nonblank source lines/pages, including
ranges crossing pages. Processing version includes the normalization/chunking revision,
estimator, target and overlap (`extraction-v1/.../t512/o64`).

## Configuration and failures

| Variable                                  | Default | Allowed                                       |
| ----------------------------------------- | ------- | --------------------------------------------- |
| `DOCUMENT_EXTRACTION_MAX_PAGES`           | 100     | 1–1000                                        |
| `DOCUMENT_EXTRACTION_MAX_EXPANSION_RATIO` | 100     | 1–1000 output UTF-16 units/input byte         |
| `DOCUMENT_PARSER_TIMEOUT_MS`              | 10000   | 1–120000, below processing timeout            |
| `DOCUMENT_PARSER_MEMORY_MB`               | 128     | 32–512, V8 old-generation heap per PDF worker |
| `DOCUMENT_CHUNK_TARGET_TOKENS`            | 512     | 4–8192 conservative budget units              |
| `DOCUMENT_CHUNK_OVERLAP_TOKENS`           | 64      | 0–8191, below target                          |

Existing `DOCUMENT_MAX_FILE_BYTES`, `DOCUMENT_PROCESSING_MAX_TEXT_CHARS` and
`DOCUMENT_PROCESSING_MAX_CHUNKS` bound source bytes, output text/total staged chunk
characters (including overlap), and chunk count. Overlap can increase total storage;
raise the total text limit or reduce overlap when needed. Text/page/byte/chunk/expansion
violations fail permanently with safe error codes. Unsupported cases are
`DOCUMENT_TEXT_EMPTY`, `DOCUMENT_TEXT_INVALID`, `DOCUMENT_PDF_INVALID`,
`DOCUMENT_PDF_ENCRYPTED` (also empty password), and `DOCUMENT_PDF_NO_TEXT` (OCR deferred).
The application also normalizes file/page/text/chunk limits, parser heap exhaustion
and parser deadlines to dedicated codes. Parser timeout is transient and uses the
existing bounded retry budget; other input/resource-limit errors are permanent.

The heap limit is a JavaScript heap bound, not a total RSS/native allocation limit.
Source bytes, output, page count, worker concurrency and termination bound ordinary
processing; hostile PDFs needing stronger isolation require a container/process RSS
limit before accepting untrusted production traffic. No sandbox security claim is made
for worker threads. The local Docker runtime uses Node 22; PDF.js requires >=22.13.

## Migration and manual verification

Back up the intended Document database and stop old workers before upgrading. The new
migration adds an EXTRACTED enum value and nullable identity/timestamp columns; old rows
are retained. No old document is declared extracted and no source identity is invented.

```bash
docker compose stop document-service
pnpm --filter @lifehelper/document-service prisma:generate
# DATABASE_URL must point to the intended Document database reachable from the host.
pnpm --filter @lifehelper/document-service db:migrate
docker compose up -d --no-deps --build document-service
```

Follow [upload walkthrough](document-upload.md), call `upload-complete`, then poll
`GET /documents/:id`. A supported file stays PROCESSING with no processing error and
remains downloadable. To inspect staging locally, use the Document database and the
UUID from your authenticated request:

```sql
SELECT status, active_generation, processing_error FROM documents WHERE id = '<document UUID>';
SELECT generation, status, chunk_count, processing_version, extracted_at
FROM document_generations WHERE document_id = '<document UUID>';
SELECT chunk_index, token_count, locator_kind, locator_start, locator_end
FROM document_chunks WHERE document_id = '<document UUID>' ORDER BY generation, chunk_index;
```

The generation must be EXTRACTED, have real chunks, and lack active READY/vectors.
Unsupported PDFs/text return FAILED with a sanitized processingError; upload itself
can still have succeeded because signature validation and full parsing are separate.
Metadata/download/delete continue enforcing current ownership. No new search API or
citation endpoint is added.

## Verification and deferred scope

Run formatter, lint, type-check, build, architecture checks, unit tests and the existing
`test:worker`, `test:persistence`, `test:storage`, `test:e2e` suites on a dedicated migrated
`*_test` database. Unit fixtures include Vietnamese multipage Type0/ToUnicode PDFs,
real image-only PDFs, valid Standard Security Handler encrypted PDFs with password and
empty-password variants, malformed PDFs and compressed text expansion. They are locally
generated test doubles, not real personal documents. Storage tests exercise the runtime
adapter through real S3 bytes/PostgreSQL; PostgreSQL tests cover staging atomicity,
fencing, deletion and no-embedding activation rejection. Community LocalStack's
anonymous access-denial check remains skipped as documented in Branch 2.

Deferred: embeddings, production model selection, pgvector indexes, READY activation,
retrieval/RAG/citations, OCR, full layout reconstruction, external event relay, Branch 8
cleanup/reprocessing, Voice/Vision, notification delivery and analytics. No paid API,
new review report file or fabricated extraction is introduced.

Parser reference: [PDF.js API](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js).

The processing timeout uses one monotonic deadline starting before the storage read.
Extraction and chunking share the remaining job budget; chunking checks the deadline
inside long text runs, and late stage results are rejected before persistence.
The parser also retains its separate, shorter parser timeout.

## Branch 5 continuation

With Branch 5 installed, the extraction transaction queues the same job for indexing
instead of ending it as SUCCEEDED. EXTRACTED remains an intermediate durable state;
complete embeddings activate READY. Historical Branch 4 successes are resumed by the
embedding migration. See [embedding runbook](document-embeddings.md).
