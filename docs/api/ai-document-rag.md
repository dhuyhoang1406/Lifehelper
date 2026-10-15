# AI document tools and grounded chat — Phase 5 Branch 7

## API and authentication

Use the existing `POST /ai/chat` and conversation routes. Document grounding is an
explicit opt-in for the current turn, not a second conversation API:

```json
{
  "prompt": "Điều kiện để được dự thi là gì?",
  "conversationId": "<optional-existing-conversation-uuid>",
  "documentScope": {
    "mode": "search",
    "documentIds": ["<owned-READY-document-uuid>"]
  }
}
```

Omit `conversationId` when starting a conversation (do not send the placeholder).
Omit `documentScope` for normal chat and existing Productivity tools. A scope defaults
to `mode:search`. Its unique document IDs are capped at 20; omission searches all
owned eligible documents, while `[]` searches none. Scoped search prompts are
limited to 1,000 characters to match Document search. Summary prompts retain the
existing 16,000-character limit. Unknown fields, null scope, malformed UUIDs and
invalid modes are rejected. Summarize requires exactly one ID:

```json
{
  "prompt": "Tóm tắt đầy đủ quy định trong tài liệu này.",
  "documentScope": {
    "mode": "summarize",
    "documentIds": ["<owned-READY-document-uuid>"]
  }
}
```

The AI HTTP adapter forwards the authenticated Identity access token and correlation
ID, matching AI → Productivity. Identity comes from the signed token, never tool
arguments. Document Service performs owner/deletion/READY/active-generation filtering
in its SQL. AI reads only `ai_db`; there are no cross-service database accesses or
foreign keys. The new document workflow test uses a separate Document process and DB.

## Response and persistence

A grounded response extends the existing envelope with application-owned citations:

```json
{
  "content": "Sinh viên phải tham dự ít nhất 80% số buổi học [1].",
  "citations": [
    {
      "reference": 1,
      "documentId": "<document-uuid>",
      "chunkId": "<chunk-uuid>",
      "generation": 1,
      "filename": "quy-che.pdf",
      "pageStart": 3,
      "pageEnd": 3
    }
  ],
  "documentCoverage": { "partial": false, "chunksRead": 1 }
}
```

The full envelope also contains conversation/message IDs, usage, provider metadata,
pendingActions and UTC createdAt as before. Text sources use `lineStart`/`lineEnd`;
PDF sources use `pageStart`/`pageEnd`. References are assigned anew each turn.
`chunksRead` counts retained source chunks, not entire document pages or tokens.
Normal responses do not gain citation fields; stored message history has nullable
`citations` and `documentCoverage`. Metadata is null when no inference was needed.

Migration `20261009000200_document_citations` adds two nullable JSONB columns to
AI messages with role/shape checks. It changes no existing rows or document tables.
Apply it to the AI database before running the new service; back up app data first.

```bash
# DATABASE_URL must point to the intended AI database reachable from this shell.
pnpm --filter @lifehelper/ai-service db:migrate
docker compose up -d --build ai-service
```

The normal message + `ai.completed` outbox transaction persists citations together.
Document tool exchanges use the existing allowlist/schema validation, conversation
message storage and version-1 `ai.tool.executed` outbox envelope. Events carry tool
name, source count, partial flag and IDs; no document text, query or token is included.
Tool result messages retain coverage counts rather than full evidence. Final citation
metadata is visible through the same owner-authorized conversation history API.

## Grounding and tool safety

`search_documents` accepts a nonblank query (≤1,000 characters) and topK 1–20.
`summarize_document` accepts one UUID matching the explicit summary scope. Neither
tool accepts user IDs, arbitrary URLs, vectors, credentials or wider document IDs.
Initial retrieval is server-initiated and validated by the existing tool registry;
additional search calls use a bounded tool loop. Summary reads chunk pages in order,
pins their generation, summarizes bounded consecutive batches and synthesizes those
summaries. It does not use top-k search as a substitute for full-document reading.

Evidence is serialized in a separate JSON user message under the evidence field,
with server reference numbers. A trusted system message treats sources, filenames,
user text and intermediate summaries as untrusted data. Grounded turns receive only
document tools; write/read Productivity tools are not advertised or executable.
Document text such as “ignore previous instructions” or “create a task now” cannot
create a pending action or bypass Phase 4 authorization. To perform an action, use
the existing normal-chat proposal and explicit confirmation/idempotency flow.

Provider output must be structured JSON with content, numeric references and an
insufficientEvidence flag. Every factual sentence must have its own citation. The
application checks references against sources actually supplied in this turn;
provider-authored filenames/locators/IDs are never trusted. Invalid references or
uncited text get at most the configured repair count, then controlled
`502 AI_GROUNDING_INVALID_RESPONSE`. No evidence returns the server-owned message
“Không đủ thông tin trong tài liệu để trả lời câu hỏi này.” and empty citations,
without an inference call. An insufficientEvidence flag similarly replaces provider
prose with this server-owned response.

After inference, each cited chunk is re-read through the authorized API to check
current generation, content prefix, filename and locator before publication. Deleted
or changed sources fail safely; previously generated prose is not published as a
successful grounded answer. As with any cross-service read, a source can change after
the final check; this is not a distributed lock or permanent source availability
promise. History retains historical citations and does not make deleted files readable.

Citation validation proves source membership and locator integrity, **not factual
entailment**. A sentence can cite a real passage while misrepresenting it. Evaluate
support on representative real documents and review important answers manually;
this feature does not eliminate hallucinations.

## Budgets and provider behavior

All settings are validated environment variables, exposed in Compose and examples:

| Variable                   |                                        Default | Meaning                                                         |
| -------------------------- | ---------------------------------------------: | --------------------------------------------------------------- |
| DOCUMENT_SERVICE_URL       | localhost:3004 / Compose document-service:3004 | HTTP origin only                                                |
| DOCUMENT_TIMEOUT_MS        |                                          30000 | Per HTTP request, including response body                       |
| AI_RAG_EVIDENCE_CHARS      |                                          12000 | Raw evidence per search context/batch and synthesis text budget |
| AI_RAG_MAX_SOURCES         |                                             40 | Retained source chunks per turn                                 |
| AI_RAG_MAX_PAGES           |                                              8 | Ordered chunk pages per summary                                 |
| AI_RAG_SUMMARY_BATCHES     |                                              4 | Consecutive summary batches                                     |
| AI_RAG_MAX_CALLS           |                                              8 | Inference calls across batches, synthesis, loop and repairs     |
| AI_RAG_TOOL_ROUNDS         |                                              2 | Additional search rounds, ≤2 calls per round                    |
| AI_RAG_REPAIR_ATTEMPTS     |                                              1 | Citation/format repair count, max 1                             |
| AI_RAG_OUTPUT_TOKENS       |                                           1024 | Grounded final output budget                                    |
| AI_RAG_BATCH_OUTPUT_TOKENS |                                            256 | Batch summary output budget                                     |
| AI_RAG_DISABLE_REASONING   |                                           true | Per-workflow provider reasoning preference                      |

Character budgets count JavaScript UTF-16 code units of evidence text; envelopes
also have bounded source counts/filenames and a bounded user prompt. Oversized chunks
use a prefix and disclose partial coverage. If pages, batches, source count or
synthesis budget stop processing, the response appends a server-owned partial-coverage
notice and reports `documentCoverage.partial:true`. It must not claim a complete
summary. Output/model context settings should fit the chosen provider.

Provider retries remain owned by the existing router; no new fallback provider is
introduced. Exhausted workflow calls return `422 AI_DOCUMENT_BUDGET_EXCEEDED`.
Document timeout/quota/unavailability/invalid response map to 504/429/503/502;
unreadable sources use safe 404. Error bodies and audit events exclude upstream bodies.
Normal chat generation defaults remain unchanged. RAG uses existing provider-neutral
structured output and per-request output budgets; Ollama now honors its reasoning
flag. Official references checked during implementation:
[Ollama chat](https://docs.ollama.com/api/chat),
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs),
[Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

## Verification

```bash
pnpm --filter @lifehelper/ai-service prisma:generate
pnpm --filter @lifehelper/ai-service prisma:validate
pnpm --filter @lifehelper/ai-service lint
pnpm --filter @lifehelper/ai-service exec tsc --noEmit
pnpm --filter @lifehelper/ai-service test --runInBand
pnpm --filter @lifehelper/ai-service build
pnpm architecture:check
pnpm architecture:test
# Use fresh migrated dedicated *_test / *_ci databases, never application DBs.
pnpm --filter @lifehelper/ai-service test:persistence
pnpm --filter @lifehelper/ai-service test:e2e
# Set DATABASE_URL, PRODUCTIVITY_DATABASE_URL, DOCUMENT_DATABASE_URL to separate test DBs.
# LocalStack S3 must be reachable through AWS_ENDPOINT_URL.
pnpm --filter @lifehelper/ai-service test:workflow
```

Drop any newly created test databases in a `finally`/shell trap on success and failure.
The cross-service fixture also deletes its own synthetic rows, object versions and
private bucket. CI uses deterministic provider results and embedding vectors; there
are no external inference requests in CI. Real Vietnamese semantic retrieval is
covered by the opt-in Branch 6 embedding/retrieval fixture.

Opt-in real grounding evaluation (synthetic evidence only, no database):

```bash
# Configure the existing real AI provider via environment; never commit credentials.
# For a repeated local clean compile, avoid stale incremental artifacts:
pnpm --filter @lifehelper/ai-service exec tsc -p tsconfig.build.json --incremental false
pnpm --filter @lifehelper/ai-service test:document-rag-smoke
```

This fixture checks a supported factual answer, an absent fact despite related
passages, document prompt injection and ordered summary. On 2026-10-09 all four cases passed using the configured Cloudflare
`@cf/zai-org/glm-4.7-flash` model. The factual case needed one bounded citation repair;
the absent fact returned insufficient information, the injection case retained
12 days instead of the injected 99, and the summary preserved both source facts.
Membership validation and manual inspection of these synthetic outputs complement the deterministic tests;
they are not proof of general factual accuracy.

Deferred: complete Document cleanup/reconciliation (Branch 8), cloud embeddings,
voice/vision, additional RAG ranking/evaluation and broader factual entailment checks.
No notification delivery or analytics scope is added. No new timestamp semantics:
message/event times remain UTC and generation is an integer, not a timestamp.
