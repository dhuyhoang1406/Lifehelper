# Lifehelper

Lifehelper is a pnpm monorepo containing a Flutter client, six NestJS services, shared TypeScript packages, and a local Docker-based development stack.

## Prerequisites

- Node.js 22+
- pnpm 11+
- Docker with Compose
- Flutter SDK (for mobile development)

## Start the complete local system

```bash
cp .env.example .env
pnpm install
pnpm prisma:generate
docker compose up -d --build
```

Service health endpoints are available at ports `3001` through `3006`:

```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
```

Readiness checks verify the service's PostgreSQL connection. LocalStack creates the `lifehelper-local` S3 bucket, the versioned `lifehelper-documents` bucket, and the `lifehelper-events` queue and its dead-letter queue automatically.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm test:persistence
pnpm prisma:validate
```

Each backend service has its own Prisma schema and PostgreSQL database. Requests accept or generate an `x-correlation-id`; the same value is returned in the response and included in structured JSON logs.
Persistence tests require those databases to be running and migrated. CI creates
an isolated PostgreSQL database per service, applies committed migrations, and
runs every service's persistence suite. See
[`docs/api/identity-auth.md`](docs/api/identity-auth.md) for the opt-in live
Google OAuth smoke test and session-revocation behavior.

## AI Service

AI Service exposes authenticated inference, persistent conversations and
Productivity tools at `http://localhost:3003`; Swagger is available at `/docs`
when enabled. Use an Identity access token for AI requests. AI owns the
`lifehelper_ai` database and accesses Productivity through its HTTP API.

Configure the provider in the root `.env` for Docker Compose, or
`apps/ai-service/.env` for direct development, using
[`apps/ai-service/.env.example`](apps/ai-service/.env.example) as the template.
Set the AI JWT secret, issuer and audience to match Identity Service.

- [Ollama setup](docs/api/ai-ollama.md): local inference without a paid API.
  Install the configured model; chat tools require a model that supports tool calls.
- [Cloudflare Workers AI setup](docs/api/ai-cloudflare.md): online inference with
  explicit account, token and model configuration. Keep credentials out of Git.

After configuring the provider and applying AI migrations, rebuild AI Service:

```bash
pnpm --filter @lifehelper/ai-service db:migrate
docker compose up -d --no-deps --build ai-service
```

The migration command reads the service's configured `DATABASE_URL`; ensure it
points to the intended AI database. Identity and Productivity must also be running
for authenticated Productivity workflows.

For example, with an access token in `ACCESS_TOKEN`:

```bash
curl --fail-with-body http://localhost:3003/ai/chat \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Tạo task đọc sách","timezone":"Asia/Ho_Chi_Minh"}'
```

Read tools run during chat. Write tools return `pendingActions`; inspect the
proposal and send its `payloadHash` to `POST /ai/actions/{actionId}/confirm`
before it executes. Include the returned `conversationId` to continue a chat.
Repeating confirmation of the same action does not repeat its completed write;
recovery after an ambiguous downstream failure has documented limitations.

See the [operational runbook](docs/api/ai-runbook.md) for test commands, isolated
PostgreSQL workflows, provider smoke tests and recovery guidance; see also
[conversations](docs/api/ai-conversations.md), [read tools](docs/api/ai-read-tools.md),
[confirmed actions](docs/api/ai-actions.md) and [audit events](docs/api/ai-events-audit.md).
Voice, Vision, Document/RAG, notification delivery and analytics consumption remain
deferred. Outbox events are persisted locally; external publishing is deferred.

## Document Service

Document Service exposes authenticated upload, completion, metadata, download and
soft-deletion APIs at `http://localhost:3004`. Set its JWT values to match Identity,
apply Document migrations and provision the dedicated versioned bucket. Clients
upload with presigned POST fields; completion reads the actual bytes, computes
SHA-256 and commits an immutable S3 version. Downloads use that committed version.

See [upload API and local walkthrough](docs/api/document-upload.md), including
configuration, a real-file example and PostgreSQL/LocalStack test commands.
LocalStack Community does not enforce anonymous S3 denial: its host port is bound
to localhost, and local tests verify private bucket configuration and API ownership.
Anonymous-denial verification requires an S3 environment that enforces access rules.
Processing jobs and lifecycle outbox events now persist atomically; the
[processing worker runbook](docs/api/document-processing.md) explains leases, crash
recovery, bounded retry and the owner-authorized retry API. Supported TXT/Markdown/PDF
files are extracted into staged chunks and embedded by local BGE-M3. READY requires a
complete active embedding generation. See [extraction and chunking](docs/api/document-extraction.md),
[embedding setup, migration and tests](docs/api/document-embeddings.md), and
[model selection ADR](docs/architecture/adr/001-document-embedding-space.md).
Retrieval HTTP APIs and AI document tools follow in Branches 6–7; cleanup arrives in Branch 8.

## Flutter

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

Android emulators use `10.0.2.2` to reach the host. For iOS simulators or desktop/web, pass `http://localhost:3001` instead.

## Pull request quality gates

Pull requests into `dev` receive an automatic AI review powered by Google Gemini
(free tier) and automatic **Technical Verification** (lint, typecheck, Prisma
validation, unit/integration tests, build, Flutter analyze/test) on every push.
The AI review is informational; the CI checks gate merging through the `dev`
ruleset.

The repository administrator must configure the following outside this repository:

1. Add `GEMINI_API_KEY` as a secret in the `Gemini` GitHub Environment (or as a
   repository Actions secret). Create a free key at Google AI Studio
   (https://aistudio.google.com/apikey). Do not add the value to repository files.
2. Create a ruleset for `dev` that restricts deletion and force pushes and requires
   a pull request. Require the `Backend quality checks` and `Flutter quality checks`
   statuses from the **Technical Verification** workflow.
3. Keep the AI review informational; do not configure it as a required status
   check.

Backend source organization and dependency rules: [service layout](docs/architecture/service-layout.md). Run `pnpm architecture:check` and `pnpm architecture:test` before changing service structure.
