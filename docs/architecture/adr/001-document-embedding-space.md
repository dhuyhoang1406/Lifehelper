# ADR 001: local document embedding space and exact cosine baseline

Date: 2026-10-09 (Asia/Ho_Chi_Minh). Status: accepted for Phase 5 Branch 5.

## Context

Document indexing must work locally without a paid API, support Vietnamese, resume
staged extraction, and preserve an identifiable embedding space across indexing/querying.
Generation stays behind AI Service's existing AIProvider; embeddings have a separate
Document Service EmbeddingProvider contract.

## Decision

Use the dense output of Ollama `bge-m3:567m`, F16, 1024 dimensions. Pin its full Ollama
manifest digest, not a mutable tag alone:

```text
7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab
```

The model card documents 1024 dimensions, an 8192-token input sequence and more than
100 languages. It is MIT licensed. BGE-M3 does not require query instructions; both
passages and queries use plain text (`plain-text-v1`). No sparse/multivector path,
reranker, generative model substitution or cloud fallback is introduced.

References verified during implementation:

- [BAAI's official model card, dimensions, context and license](https://huggingface.co/BAAI/bge-m3).
- [Ollama BGE-M3 distribution](https://ollama.com/library/bge-m3).
- [Ollama embed API](https://docs.ollama.com/api/embed).
- [Ollama embedding guidance](https://github.com/ollama/ollama/blob/main/docs/capabilities/embeddings.mdx).
- [pgvector exact search and cosine distance](https://github.com/pgvector/pgvector).

Use `/api/embed` with an ordered input array and `truncate:false`. Verify the installed
manifest digest before and after each batch and validate returned model, batch size,
finite float32-representable nonzero vectors and dimensions. Map response array position
to the corresponding request item ID; Ollama does not return per-input IDs, so the
adapter relies on its ordered-array API contract. The application rejects reordered
IDs in a provider result. This does not detect a faulty server silently permuting
vectors within an otherwise valid array. Batch/single ordering is exercised separately.

The existing UTF-8-byte upper-bound estimator limits plain-text inputs conservatively;
it is not BGE-M3's tokenizer. The actual model context is also enforced by Ollama and
oversized input fails instead of being silently truncated. Default chunks are only
512 estimated tokens with 64 overlap. Full vectors are retained without dimensional
reduction. Store model/tag, manifest digest, dimensions, extraction version and
embedding input/batch settings on the processing generation.

## Local selection evidence

The checked-in eight-document/eight-query Vietnamese fixture covers exam eligibility,
leave, refunds, backups, library access, travel reimbursement, account recovery and
delivery. Queries paraphrase their target passages. All documents were uploaded into
versioned LocalStack S3, extracted and embedded by the real local adapter, committed
READY on PostgreSQL/pgvector, and searched with exact cosine using the same model.
Ollama 0.12.3 served the pinned F16 model. Initial run on 2026-10-09:

| Target   | Top-1 cosine | Correct |
| -------- | -----------: | ------- |
| exam     |       0.6782 | yes     |
| leave    |       0.7621 | yes     |
| refund   |       0.6465 | yes     |
| backup   |       0.6512 | yes     |
| library  |       0.7431 | yes     |
| travel   |       0.6337 | yes     |
| account  |       0.6767 | yes     |
| delivery |       0.7591 | yes     |

Top-1 accuracy: 8/8. This small acceptance fixture supports the initial selection;
it is not a general Vietnamese retrieval benchmark or a confidence threshold. No
comparison winner across multiple models is claimed. Repeat with the opt-in
`test:embedding:smoke` command and the fixture in `test/fixtures/vietnamese-retrieval.json`.

## Persistence, compatibility and consequences

Keep the existing variable-dimension pgvector column, using explicit SQL inside Document
persistence. The initial deployed migration already enabled the extension, so Branch 5
uses `CREATE EXTENSION IF NOT EXISTS vector` and adds compatible constraints/metadata;
it does not rewrite migration history. Exact cosine scans are the baseline for the
small corpus. No HNSW/IVFFlat index is warranted by the current measured fixture workload.
A larger measured workload must justify an approximate index in a later change.

Queries materialize only owned, nondeleted READY documents' active COMPLETE generations
with an exact model/digest/dimensions match and the supported plain-text input policy before computing distance. An incompatible
space has no results; it is never compared to the query vector. Changing a model,
weights, dimensions or input transformation requires reindexing. Existing historical
spaces remain identifiable and are not silently relabeled as the new model. The
owner-authenticated retrieval API belongs to Branch 6; this branch exposes no search
HTTP route. Operational reindex/cleanup remains Branch 8.

CI uses the deterministic fake only in NODE_ENV=test; it measures integrity and lifecycle,
not semantics. It never downloads models or calls external APIs. Runtime embedding
unavailability causes bounded retry/controlled failure, never fake or paid fallback.
