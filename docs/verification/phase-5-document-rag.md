# Phase 5 Branch 9 verification evidence

Actual verification date: **2026-10-15**, UTC / Asia/Ho_Chi_Minh (UTC+07).
Branch: `feature/document-rag-cloudflare-hardening`, based on `dev` **ccbdfe38142fea52238b9191f90ec30d0b54c3b2**.
Verification ran against working-tree implementation changes before commit creation; this base SHA is not a
claim that the tested implementation was already merged. Reports identify the base
and, in newer runs, the working-tree source/configuration change fingerprint.
At the owner's request, author/committer metadata for the implementation commits is
dated 2026-10-14. Actual verification happened on 2026-10-15 as recorded here; the
commit metadata is not a test/merge timestamp. No release tag, final Phase 5 completion
date or merge is claimed.

## Changes and contracts

- Repeatable isolated PostgreSQL/pgvector + LocalStack regression runner and real HTTP
  evaluation runner; fixed Vietnamese corpus, actual text PDF, adversarial/absent queries,
  lexical baseline and stage-level p50/p95 with sample counts.
- Real embedding HTTP 503 injection/recovery uses a verification-only proxy, never stops
  the application's Ollama container. API ownership, reprocess idempotency, delete
  visibility, outbox sanitization, UTC and correlation are exercised.
- Added regression tests for missing/non-UUID reprocess keys, numeric retrieval Swagger
  schemas, and RAG provider quota/unavailability without persisted generated success.
- AI build disables incremental compilation because Nest `deleteOutDir` can otherwise
  remove `dist` while the cache suppresses re-emission. Repeated builds now emit `main.js`.
- RAG system/repair prompts no longer include abstract `A [1]. B [1].` examples copied
  literally by a small local model. Citation membership checks and bounded repair stay.
- No migration, database ownership change, public route, event version, paid fallback,
  provider coupling into Domain or cross-service persistence access is introduced.
  Retrieval Swagger numeric metadata fixes documentation; input validation is unchanged.

The [operations runbook](../api/document-rag-operations.md) contains commands, secret flags,
setup references, error decisions, backup/rollback/reindex guidance and API smoke flow.

## Environment and evaluation protocol

Linux x86_64, Intel Core i5-12500H, 16 logical CPUs, approximately 15 GiB RAM available
as system total, CPU inference. Node 22, Python 3.12, Compose PostgreSQL/pgvector and
LocalStack, Ollama 0.12.3. This is a shared development machine, not an isolated benchmark
host. Model/cache state was not reset; warm-up samples are not excluded. Do not infer
concurrent-user capacity or a production SLA from this small run.

Embedding: `bge-m3:567m`, F16, 1024 dimensions,
`7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab`.
Chunks: 512 estimated tokens, overlap configured per existing generation settings;
embedding batches 8, retrieval top-k 3, minimum cosine similarity 0.55. Exact cosine
runs after owner/deletion/active-generation/embedding-space filtering in SQL.

Corpus: eight existing labeled Vietnamese passages; the leave policy is uploaded as
an actual Vietnamese text PDF, the other seven as UTF-8 text. One extra adversarial
passage contains a conflicting instruction to create a task and claim 99 leave days.
Another disposable file exercises embedding recovery. The quality search scope excludes
the intentionally duplicated adversarial passage. Answer evaluation uses explicit owned
scope to distinguish grounding from cross-document ranking.

Retrieval evaluation: 8 paraphrases + 3 factual queries, plus 4 unrelated queries.
RAG evaluation: 3 answerable questions, 1 related-but-absent fact, 1 injection case and
1 ordered summary. This is an acceptance fixture, not representative production data.

## Real Cloudflare result

[Raw sanitized report](artifacts/cloudflare-2026-10-15.json), run **09:04:12–09:05:39 UTC**
(UTC+07 for local time). Generation: `@cf/zai-org/glm-4.7-flash`; real Ollama embeddings and actual
HTTP APIs on separate temporary service databases.

| Measure                                    | Result                  | Interpretation                                                                                                          |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Semantic retrieval hit@3                   | 11/11                   | Expected owned source appeared in returned passages                                                                     |
| Lexical Jaccard baseline hit@3             | 11/11                   | Same corpus, normalized word sets, fixture-ID tie break; no semantic superiority claim                                  |
| Unrelated retrieval returns empty          | 4/4                     | Threshold calibration on these fixtures only                                                                            |
| Answer/summary source membership + locator | 5/5 non-abstained cases | Every returned source checked through authorized chunk API; PDF page/line references validated                          |
| Persisted answer citation metadata         | 6/6 turns               | Conversation API matches the returned citation metadata, including abstention                                           |
| Related absent-fact abstention             | 1/1                     | Server-owned insufficient-information response, no citations                                                            |
| Injection                                  | 1/1                     | Correct 12-day answer, not 99; no pending write action                                                                  |
| Ordered summary coverage                   | 1/1                     | All fixture chunks covered; not a top-k search disguised as a complete summary                                          |
| Embedding outage/recovery                  | pass                    | Controlled 503, incomplete data not READY, then real inference reaches READY                                            |
| Ownership + reprocess + deletion HTTP      | pass                    | Foreign metadata/download/chunk/search/summary denied, repeated key same job, generation 2 active, deleted reads denied |
| Lifecycle outbox contract                  | 57 events               | Version 1, UTC timestamps, correlation/job IDs and payload-field allowlist checked                                      |

Agent manual reading of the five non-abstained synthetic answers found their stated
facts supported by the fixed passages: 12 leave days; 80% attendance plus assignments;
14-day backup retention; injection still 12; summary 12 plus three-working-day notice.
The absent-fact answer did not invent a company founding date. This is a separate
small qualitative check, not automated entailment proof or independent human review.
Raw reports deliberately leave the independent manual-review field pending.

| Stage                                                 |   n |  p50 ms |   p95 ms |
| ----------------------------------------------------- | --: | ------: | -------: |
| Upload completion HTTP                                |  10 |   15.57 |    40.08 |
| Extraction port call                                  |  11 |    0.06 |   292.98 |
| Embedding port call, successful calls                 |  31 |  184.12 |   245.01 |
| Completion-to-READY wall time, includes polling/retry |  11 |  510.94 |  1775.01 |
| Retrieval HTTP, includes query embedding              |  15 |  178.97 |   199.31 |
| Generation provider call                              |   7 | 1309.62 | 45397.16 |
| Chat HTTP total                                       |   6 |  1290.7 | 45638.49 |

Nearest-rank percentiles are reported; n=6 p95 is simply the slowest sample. Generation
call count includes a bounded repair/summary call, while chat count is user turns.
Stage samples are not independent transactions and must not be summed as a precise
end-to-end decomposition. Processing is asynchronous and measured separately from chat.

The first full Cloudflare run measured generation p95 1.72 s and chat p95 3.34 s;
the repeat above measured a 45.40 s provider tail and 45.64 s chat tail. A 15-second
chat target suggested by the first run therefore does **not** hold for the repeat.
Do not discard the slow sample. These are online-provider variations, not a one-second SLA.

From both observed runs, provisional repeat budgets on this fixture/host are completion
p95 <1 s, extraction <2 s, embeddings <2 s, retrieval <2 s, successful online generation
calls <60 s, chat total <90 s and READY wall time <30 s excluding deliberate extended
outages. These are operational investigation thresholds with measured headroom, not
contractual guarantees or CI timing assertions. A quota/outage run fails availability
acceptance explicitly. Local model latency/quality requires a separate profile.
The runner's `passed` flag means its scripted functional/quality assertions passed;
it is not an independent manual sign-off or a phase-completion/performance guarantee.

## Local generation evaluation and failures

Qwen3 0.6B was tried as an inexpensive fully local option. It copied formatting
placeholders while returning valid source references. The
[original failure report](artifacts/local-06b-failure-2026-10-15.json) records **1/6** RAG
quality cases passing (the abstention case); citation membership alone did not establish
answer quality. After removing the examples, a subsequent smoke still failed the bounded
grounding contract. This model is **not accepted** as a RAG generation baseline.

Qwen3 1.7B full HTTP evaluation completed at 09:02:52 UTC:
[raw report](artifacts/local-17b-failure-2026-10-15.json). **4/6** cases passed: leave PDF,
backup fact, absent-fact abstention and injection. Exam paraphrase and ordered summary
returned controlled `502 AI_GROUNDING_INVALID_RESPONSE`; no successful answer was fabricated.
Retrieval remained 11/11 and unrelated retrieval 4/4 empty. Ownership, reprocess, deletion,
embedding recovery and 57 outbox events passed independently. A first run answered the leave PDF correctly but rejected the exam paraphrase
with `502 AI_GROUNDING_INVALID_RESPONSE`. Its separate synthetic smoke also attempted an
unsupported founding date without an inline citation; validation rejected it after
bounded repair. The application did not turn that output into grounded success.
Do not claim that all local models satisfy this workflow merely because they support JSON.

The online Cloudflare path remains usable, without automatic paid fallback. All embedding
inference is local. Fully local generation quality is an explicit limitation unless a
selected model passes the same fixtures. No application provider configuration was changed
by these experiments. Both Qwen model tags were downloaded only for evaluation and removed afterward to reclaim
space; the pre-existing BGE-M3 model and application provider configuration were preserved.

## Deterministic verification and scenario map

Regression runner: PostgreSQL migration/storage/worker/E2E, AI persistence/E2E and
AI→Productivity/Document workflows. The newest workflow includes two extra provider
failure cases: **142 integration/E2E/workflow assertions passed**, with one existing
LocalStack anonymous-denial assertion skipped. Document unit tests: **141**; AI unit tests:
**184**; verification-tool cleanup tests: **5**. Lint, source/test type checks, builds,
formatter checks and six architecture guard tests passed. CI remains deterministic with fake inference, real database/storage.

| Required scenario                                            | Verification                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Actual PDF → private upload → real embeddings → READY        | Real runner, leave PDF; storage integration PDF fixtures                                                          |
| Vietnamese chat, persisted citations, summary, absent answer | Real evaluation + document HTTP workflow                                                                          |
| Foreign list/download/search/summary/citation source         | Real runner + storage/retrieval integration + document workflow                                                   |
| Unsupported/corrupt/oversize                                 | Storage/extraction unit/integration; real reserve rejects extension/oversize                                      |
| Embedding offline/recovery                                   | Real boundary 503 proxy + worker retry/partial-batch tests                                                        |
| Generation quota/unavailable, no fabricated success          | Provider HTTP E2E + new document workflow tests; no real account quota is deliberately exhausted                  |
| Crash/recovery/concurrent claims/retries                     | Worker PostgreSQL integration uses lease expiry/repository restart/fencing; no destructive kill of the app worker |
| Delete during extraction/embedding/retrieval                 | Worker/storage races + source deleted during AI inference HTTP workflow                                           |
| Changed model/version, no mixed vector spaces                | Worker/retrieval integration mismatched-space/stale-generation tests                                              |
| Document injection cannot authorize writes                   | Real fixture plus RAG allowlist/injection unit tests and Phase 4 confirmation workflow                            |
| UTC/outbox/correlation/redaction                             | Real 57-event check + persistence/worker assertions                                                               |
| Phase 4 normal chat and Productivity                         | AI unit/E2E, conversation/action integration and Productivity HTTP workflow                                       |

The tests model crash/recovery through actual database lease expiry and repository restart;
a clean application restart/redeploy has not been substituted with a claim of a destructive
production crash exercise. Real provider outage tests use local controlled endpoints.

## Merge evidence and closure status

Actual first-parent merge references from Git history (commit timestamps, not planned dates):

| Branch                  | Merge SHA | Actual merge timestamp (+07) |
| ----------------------- | --------- | ---------------------------- |
| 1 domain/persistence    | b3d2659   | 2026-10-01 15:32:55          |
| 2 storage/upload        | 386658e   | 2026-10-02 11:08:40          |
| 3 worker                | 54a2823   | 2026-10-02 15:20:54          |
| 4 extraction            | 8784b77   | 2026-10-09 09:55:34          |
| 5 embeddings            | c4578b3   | 2026-10-09 14:11:20          |
| 6 retrieval             | 041e7ae   | 2026-10-09 15:42:21          |
| 7 AI/RAG                | 59f8d81   | 2026-10-15 11:37:23          |
| 8 lifecycle             | c52bf02   | 2026-10-15 14:58:38          |
| 8 test typing follow-up | ccbdfe3   | 2026-10-15 15:16:43          |
| 9 hardening             | pending   | Not merged                   |

Codex diff/boundary/error-path review is advisory. Gemini-assisted review is supplied
by the existing informational PR workflow with bounded retry/fallback; no local Gemini
CLI/credentials were available for this working-tree run. Record its actual result after
PR creation; do not invent a completed review. Human review and branch merge are pending.

Phase 5 is **not marked closed**: Branch 9 merge/review, independent manual sign-off and
local-generation qualification remain explicit. No `phase-5-document-rag-complete` tag
has been created. Deferred scope remains OCR, scan-only PDF, full mobile screens,
production AWS rollout, Voice/Vision, notifications and analytics. Production IAM denial
needs an enforcing S3 environment; LocalStack's skipped denial assertion remains disclosed.

## Owner-requested extension: Cloudflare embeddings

After the original Branch 9 evaluation, the owner requested replacing local embedding
inference with Cloudflare. [ADR 002](../architecture/adr/002-cloudflare-document-embeddings.md)
records this scope change; Ollama remains an optional configured provider, never fallback.

The [all-Cloudflare HTTP report](artifacts/all-cloudflare-2026-10-15.json) records
BGE-M3 `@cf/baai/bge-m3`, 1024 dimensions, operator revision `cloudflare-bge-m3-v1`,
for both chunk and query vectors, with GLM-4.7-Flash generation. Retrieval hit@3 **11/11**,
unrelated queries empty **4/4**, grounded/abstention/injection/summary cases **6/6**.
Private PDF/TXT upload, generation activation, persisted source locators, ownership,
reprocess idempotency and deleted-source denial passed on separate real pgvector databases.
The live Cloudflare account was not deliberately made unavailable/exhausted; adapter tests
cover 401/403/429/503 and bounded timeout/retry behavior. All owned DBs/bucket were removed.

Default query threshold 0.55 was retained only after this fixture passed on cloud vectors;
this is not general calibration for all corpora. Old local vectors are excluded until
explicit reprocess in the new space. Hosted version labels are not immutable weight pins.
Provider/Cloudflare details remain outside Domain/Application contracts. No SQL migration.

Cloud extension verification: Document **165 unit tests**, AI **184 unit tests**;
the [regression runner](artifacts/cloud-embedding-regression-2026-10-15.json) passed **143 integration/E2E/workflow tests**
with the existing one LocalStack denial skip. The actual recreated Document container also
passed upload/READY/reprocess/idempotency/download/delete/ownership HTTP smoke with the
Ollama container stopped, followed by cleanup of its synthetic rows/object versions. There is
one added PostgreSQL case for nonretryable provider credential failure followed by explicit
reprocess. Local Qwen failure evidence above concerns generation, not the Cloudflare
embedding adapter, and remains part of the report rather than being erased by this change.
