# ADR 002: optional Cloudflare document embeddings

Date: 2026-10-15. Status: implemented at the project owner's request, superseding the
local-only provider preference in the original Phase 5 plan. ADR 001 remains the
supported Ollama/offline path. Generation and embedding provider ports stay separate.

## Decision

Add Cloudflare Workers AI `@cf/baai/bge-m3` behind Document Service's existing
`EmbeddingProvider`. Both document chunks and search queries use this single selected
provider/space. Exact cosine retrieval remains in Document PostgreSQL/pgvector; no
Cloudflare Vectorize or cross-service persistence is added. No new database migration.

The REST request is `POST /client/v4/accounts/{account}/ai/run/@cf/baai/bge-m3`
with ordered `text` strings and `truncate_inputs:false`. A real request on 2026-10-15
returned `success:true`, `result.shape:[2,1024]` and two 1024-value `result.data` rows.
The documentation's usage examples use `text`; its parameter panel also describes a
`contexts` form. The adapter implements the verified embedding response, never a
reranker response. It validates the envelope, exact batch cardinality/shape, finite
float32-representable nonzero vectors and order-to-item mapping.

The provider returns positional vectors, not caller item IDs. Mapping preserves array
order; deterministic tests enforce it, and the real corpus verifies expected sources.
This cannot prove a faulty upstream has not silently permuted otherwise valid vectors.

The new space is:

```dotenv
EMBEDDING_PROVIDER=cloudflare
EMBEDDING_MODEL=@cf/baai/bge-m3
EMBEDDING_MODEL_VERSION=cloudflare-bge-m3-v1
EMBEDDING_BASE_URL=https://api.cloudflare.com
EMBEDDING_DIMENSIONS=1024
```

`EMBEDDING_MODEL_VERSION` is an **operator-controlled deployment revision**, not an
upstream immutable weight digest. Cloudflare does not expose the Ollama manifest pin.
Record evaluation date/revision, bump it and reindex on provider/model/input-policy
changes; hosted weight changes cannot be cryptographically pinned by this adapter.
Same model family and dimensions do not make Ollama and Cloudflare interchangeable:
the distinct model/revision prevents mixed-space SQL comparisons.

Cloudflare connection/model details stay in Infrastructure, composition and validated
configuration. Domain/Application receive generic embedding contracts/settings.
Local Ollama and the deterministic test fake remain available, with no automatic fallback.

## Security, limits and errors

Only the configured official HTTPS Cloudflare API origin is accepted, preventing
credential forwarding to arbitrary origins/redirects. Account ID and token are required
only when Cloudflare embeddings are selected. Document Service receives its own validated
configuration; it does not query AI Service's database or call the chat provider for vectors.
`CLOUDFLARE_API_TOKEN` is a secret with Workers AI permission. Prefer a service-scoped token;
the local configuration can use the already-authorized account token used for chat.

Selecting cloud embeddings sends extracted passage and query text to Cloudflare. Source
files and retrieval ownership stay private in Document storage/DB. No text, token, URL or
upstream response body is added to audit/outbox/errors. Vector outputs are bounded by
bytes, shape and dimensions before use. Conservative 8192 estimated input tokens and
existing 512-token chunks remain; do not silently truncate long input.

Embedding HTTP parsing, timeouts and retry rules are shared with the existing Ollama
adapter. Retry only transient 429/network/5xx/timeout failures with bounded attempts and
jitter. 401/403 produce permanent `DOCUMENT_EMBEDDING_UNAUTHORIZED`; automatic jobs stop
rather than hammer credentials. After fixing credentials an owner may explicitly call
`/reprocess`. Search maps provider authorization failure to a sanitized service 503,
not a misleading caller authentication 401. No paid fallback is introduced.

Workers AI's free allocation is 10,000 neurons/day shared by the account's generation
and embedding requests. On Workers Free, exceeding the allowance fails; a Paid account
can incur usage beyond it. This change does not upgrade a plan or configure billing.
No claim of unlimited free inference is made. Reindexing consumes embedding quota.

## Rollout and rollback

Apply the five space/provider settings above plus `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`; rebuild/recreate Document Service. Neither Ollama nor a local
embedding container is required when Cloudflare is selected. Existing local-space
vectors remain stored but are excluded by query-space filtering until reprocessed.

Use owner-authenticated `POST /documents/{id}/reprocess` with a fresh UUID key for each
eligible document. Do not edit vector/model columns, fabricate checksums or silently
reinterpret old vectors. Wait for the new generation to become active. If its exact
committed source version is missing, restore the matching backed-up bytes/metadata or
upload a new document; changing providers cannot recover lost source objects.

There is one configured query space, so switching before reindex can temporarily return
no matching results. There is no zero-downtime dual-space rollout claim. Operator rollback
restores the previous provider/model/revision; any documents whose active generation is
now cloud-space need explicit reprocess back to the old space. Historical citations may
become unavailable after retention/deletion. Do not reset a database or delete model rows
as a provider-switch procedure.

## Verification

```bash
pnpm --filter @lifehelper/document-service test --runInBand
pnpm verify:document-rag --mode regression
pnpm verify:document-rag --mode real --embedding-provider cloudflare \
  --report /tmp/phase5-all-cloudflare.json
```

Real evaluation uploads a Vietnamese text PDF plus fixed TXT fixtures into private
LocalStack S3, embeds chunks/queries through Cloudflare, searches real pgvector, asks
Vietnamese questions/summaries through the existing chat, checks citations/persistence,
owner isolation, reprocess and deletion. It creates and drops only its own DBs/bucket.
Unit tests cover malformed shape/cardinality/dimensions/values, non-UUID config space,
401/403/429/503 handling, response-size/time limits and cancellation. CI uses fake models;
real calls remain opt-in. See the Phase 5 evidence report for measured results/limitations.

Official references verified on 2026-10-15:

- [BGE-M3 model and REST usage](https://developers.cloudflare.com/workers-ai/models/bge-m3/).
- [Workers AI pricing and free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/).
- [BAAI BGE-M3 model card/license](https://huggingface.co/BAAI/bge-m3).
