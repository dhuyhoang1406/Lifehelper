# Phase 5 Branch 1 verification — 2026-10-01

Branch: `feature/document-domain-persistence`, created from latest fetched `dev`.
The project owner explicitly requested Phase 5 using the supplied specification;
Phase 4 deferred findings are not included in this branch.

## Scope and boundaries

Document-owned lifecycle, processing generations, active-generation pointers,
optimistic revisions, durable job schema, chunk locators and embedding metadata.
Domain imports no NestJS, Prisma, SDK, parser or vector persistence types.
Application repository ports contain only service-owned entities/primitives.
Infrastructure adapters use only Document's generated client/database.
No cross-service foreign keys, APIs or provider dependencies are added.

Repository registration is wired into the existing module; controllers stay
unchanged. Former unscoped document/chunk reads are replaced with owner-scoped
reads. There were no production call sites of the former ports beyond the baseline
persistence test. Metadata-only embedding staging does not enable READY.

## Migration, contracts and security

One transactional forward migration adds generation/job tables, internal FKs,
per-generation chunk uniqueness, indexes and database lifecycle constraints.
Existing Phase 0 vectors are retained, dimensions inferred and model version
labelled legacy; the existing vector column becomes nullable. No final embedding
dimensions, index or embedding integration is selected.

Normal queries filter owner and deleted status. Collection reads are bounded.
Generation starts serialize via revision/row updates and roll back if job insertion
fails; generation activation serializes with document deletion/start/chunk writes
through the owner document lock. READY requires contiguous chunks with locators,
token counts and vectors. Illegal transitions and changes to owner/object identity
are also rejected by a database trigger. Raw error text is rejected in favor of
stable uppercase error codes. No secret, source document body or presigned URL is
added to logs/events. No public API/event contract changes occur in this branch.

Timestamps remain TIMESTAMPTZ and round-trip as ISO UTC; test fixtures include a
+07:00 instant. Job timing is persisted, not supplied by inference.

## Commands and results

Run in `apps/document-service` using installed binaries:

| Verification          | Command                                                                    | Result |
| --------------------- | -------------------------------------------------------------------------- | ------ |
| Schema                | `./node_modules/.bin/prisma validate`                                      | Pass   |
| Client generation     | `./node_modules/.bin/prisma generate`                                      | Pass   |
| Lint                  | `./node_modules/.bin/eslint '{src,test}/**/*.ts'`                          | Pass   |
| Typecheck             | `./node_modules/.bin/tsc --noEmit -p tsconfig.json`                        | Pass   |
| Build                 | `./node_modules/.bin/nest build`                                           | Pass   |
| Unit                  | `./node_modules/.bin/jest --runInBand`                                     | 15/15  |
| Real PostgreSQL       | `./node_modules/.bin/jest --runInBand --config test/jest-persistence.json` | 9/9    |
| HTTP health contracts | `./node_modules/.bin/jest --runInBand --config test/jest-e2e.json`         | 3/3    |

Root Prettier check over Document source, changed persistence test and new docs
passes; `git diff --check` passes. Generated source is excluded from handwritten
review. Existing ts-jest configuration warns about generated JavaScript; the suites
still pass. No Flutter, provider or S3 behavior changes require tests in this branch.

Clean migration tested against dedicated
`lifehelper_document_phase5_final_test` on PostgreSQL/pgvector at localhost:55432;
both baseline and new migration applied. Existing-data upgrade tested separately in
`lifehelper_document_phase5_upgrade_test`: legacy content and [0.1,0.2] vector
survived with generation 1, dimensions 2 and modelVersion legacy. These dimensions
are synthetic fixtures, not a model choice. Application databases/containers were
not rebuilt or migrated. Tests clean only their synthetic owner fixtures.

Codex review covered domain transitions, CAS races, rollback, schema/mapper
consistency and ownership. Revisions made during review included requiring a
completed domain generation for markReady, rejecting metadata-only activation,
validating new chunk locators and supporting isolated CI database names in tests.
Final Gemini-assisted review is pending: no local Gemini key/CLI is available;
the existing PR Gemini workflow can supply review when the branch is published.
This report is informational, not approval to merge. No PR was approved/merged.

## Recovery and deferred work

See [Document migration instructions](../database/document-migrations.md) for
legacy-data preflight, failed migration recovery, rollback and verification.
Do not reset a database containing real documents. Legacy READY data without safe
locators needs explicit reconciliation before upgrade; migration does not invent
source evidence.

Deferred to subsequent branches: S3 upload/download and verification, processing
worker/lease recovery/outbox dispatch, parsing and extraction, reproducible chunking,
Ollama embeddings/vector index, retrieval/citations, AI document tools and RAG,
lifecycle cleanup/audit, live smoke/evaluation and full runbook. OCR, voice/vision,
notification delivery, analytics, full Flutter screens and AWS production deployment
remain outside scope. No commit, push, tag or next branch was created for this handoff.
