# Authorized document retrieval — Phase 5 Branch 6

## Scope and trust boundary

Document Service owns embedding/search and reads only its own database. AI Service
will consume these APIs in Branch 7. Forward the current user's Identity access JWT
as `Authorization: Bearer <accessToken>`, following the existing AI → Productivity
integration. The guard verifies signature, issuer, audience and access-token claims;
the owner is the verified `sub`. A user ID header/body cannot establish identity.
The `/internal` prefix describes the consumer; it does not grant service-wide access.
Deployment network routing should expose these routes only to intended consumers.

All routes require authentication. DTO validation rejects arbitrary vectors,
unrecognized properties, malformed IDs and out-of-range limits. SQL restricts owner,
nondeleted READY documents and COMPLETE active generations before cosine ranking.
Search also checks exact model, manifest digest, dimensions and plain-text input
policy. Incompatible stored generations are excluded and require reindexing.
No object key, bucket, storage version, raw vector or signed URL is returned.
Document excerpts are untrusted source content, not instructions for an AI agent.

## Search

```http
POST /internal/documents/search
Authorization: Bearer <accessToken>
Content-Type: application/json

{"query":"Nhân viên được nghỉ phép bao nhiêu ngày?","topK":5,"documentIds":["<owned-document-uuid>"]}
```

`query`: nonblank trimmed text, at most 1,000 UTF-16 code units. `topK`: integer
1–20, default 5. `documentIds`: optional unique UUID array, at most 50. Omission
searches eligible owned documents; an empty array returns `{"items":[]}` without
inference. Every explicitly requested ID must belong to this user and be nondeleted;
foreign, deleted and missing IDs receive the same `404 DOCUMENT_NOT_FOUND`.
Owned nonready documents are excluded from ranking.

The service creates the query embedding using the configured embedding space.
Results have this shape (IDs below are placeholders):

```json
{
  "items": [
    {
      "documentId": "<document-uuid>",
      "chunkId": "<chunk-uuid>",
      "chunkIndex": 0,
      "generation": 1,
      "filename": "policy.txt",
      "excerpt": "Nhân viên có 12 ngày phép năm.",
      "locator": { "kind": "LINE", "start": 1, "end": 1 },
      "similarity": 0.726318
    }
  ]
}
```

Excerpts are prefixes capped at 1,200 PostgreSQL characters per result, at most 20
results. Locators identify the original chunk's inclusive line/page range; the
excerpt can cover less than that range. Scores use `1 - cosine distance`, bounded
to [-1,1], and are neither probabilities nor proof that a question is answerable.
Exact cosine behavior follows the [pgvector documentation](https://github.com/pgvector/pgvector#distances).
Empty corpus and evidence below the configured threshold return `200 {"items":[]}`.
Do not turn no-results into a provider failure or a fabricated answer.

## Chunk reading and generation-safe pagination

```http
GET /internal/documents/:id/chunks?limit=10
GET /internal/documents/:id/chunks?limit=10&generation=1&after=9
GET /internal/documents/:id/chunks/:chunkId?generation=1
```

Chunk list returns `{items:[...],next:{generation,after}|null}`. Each item contains
`documentId`, `chunkId`, `generation`, `chunkIndex`, `filename`, `content`, `locator`.
`after` is an exclusive chunk index (default -1); `limit` is 1–20 (default 10).
A continuation (`after >= 0`) must supply the generation returned in `next`.
Generation must still be active: reindexing cannot silently switch a cursor to
new content. Old chunk IDs and inactive generation requests return safe 404.
An exhausted valid page returns empty items with `next:null`. Individual chunks
and total page content are capped at 32,768 UTF-16 code units. Pages stop at whole
chunk boundaries and return a continuation; an oversized single chunk returns 413.

## Configuration, errors and calibration

- `DOCUMENT_RETRIEVAL_TIMEOUT_MS=25000`: overall query embedding deadline,
  including provider retries. Existing per-attempt embedding timeouts/retry limits
  still apply; this API does not add another retry loop.
- `DOCUMENT_RETRIEVAL_MIN_SIMILARITY=0.55`: model/corpus-specific baseline calibrated
  for the pinned BGE-M3 digest in [ADR 001](../architecture/adr/001-document-embedding-space.md).
  Recalibrate when changing model or corpus; never treat this as a universal cutoff.
- Embedding timeout → 504; quota → 429; unavailable/model mismatch → 503;
  invalid provider result → 502; input limit → 400. Error bodies are sanitized
  `{code,message,correlationId}` without provider bodies, query or document text.

The Vietnamese fixture contains 8 paraphrases and 3 exact factual questions; all
11 retrieved their expected document first with real Ollama. Positive top-1 scores
were 0.633685–0.762101. Four unrelated questions scored at most 0.434765 and all
returned no results at 0.55. This small fixture does not establish production
recall or answerability: a related question asking an absent fact can still retrieve
a relevant passage. Grounded answer evaluation and abstention belong to Branch 7.

## Local verification

Rebuild the document service after applying this branch:

```bash
docker compose up -d --build document-service
```

Use Swagger at the configured documentation path or:

```bash
read -rs ACCESS_TOKEN
export ACCESS_TOKEN
curl -sS http://localhost:3004/internal/documents/search \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"Nhân viên có bao nhiêu ngày phép năm?","topK":5}'
unset ACCESS_TOKEN
```

The file must finish processing to READY first. Tests:

```bash
pnpm --filter @lifehelper/document-service test --runInBand
pnpm --filter @lifehelper/document-service lint
pnpm --filter @lifehelper/document-service exec tsc --noEmit
pnpm --filter @lifehelper/document-service build
pnpm architecture:check
pnpm architecture:test
# DATABASE_URL must point to a fresh, migrated dedicated *_test / *_ci database.
pnpm --filter @lifehelper/document-service test:worker
pnpm --filter @lifehelper/document-service test:persistence
pnpm --filter @lifehelper/document-service test:storage
pnpm --filter @lifehelper/document-service test:e2e
```

The worker integration suite also exercises real PostgreSQL + authenticated HTTP
retrieval, pagination, unauthorized requests, optional ID restrictions, reindexing
and deleted/nonready generations. Unit tests inject deterministic provider results
and failures; CI never calls external inference. The opt-in real-model smoke in the
[embedding runbook](document-embeddings.md) additionally checks all 15 retrieval
questions, source locators and cross-user isolation. Always drop a newly created
temporary database in `finally`, on success and failure; never target application DBs.

No migration or event contract change is required. No new timestamp fields are
introduced; existing UTC persistence remains unchanged. Deferred: AI document tools,
grounded answers, richer relevance/answerability evaluation, approximate indexes,
cloud embeddings, complete cleanup and expiry reconciliation.
