# AI Service operational runbook

## Boot and configuration

Use `apps/ai-service/.env.example` as the full environment template. Do not commit
real `.env` files or put access tokens into logs. Each service owns its database;
AI accesses Productivity through HTTP, never through its Prisma client.

| Variables                                                                                                     | Purpose                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`                                                                      | Explicit provider, model and endpoint. Cloudflare requires HTTPS.              |
| `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_CONTEXT_MESSAGES`                                            | Provider deadline, output budget and non-system context limit.                 |
| `AI_RETRY_MAX_ATTEMPTS`, `AI_RETRY_BASE_DELAY_MS`                                                             | Bounded provider retries. No automatic provider fallback.                      |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`                                                               | Required only with Cloudflare; API token is a secret.                          |
| `PRODUCTIVITY_SERVICE_URL`, `PRODUCTIVITY_TIMEOUT_MS`                                                         | Productivity API address and deadline. Writes are never automatically retried. |
| `AI_ACTION_CONFIRM_TTL_SECONDS`                                                                               | Pending action expiry; default 600 seconds, validated range 60–3600.           |
| `DATABASE_URL`                                                                                                | AI-owned PostgreSQL URL; treat embedded credentials as secrets.                |
| `JWT_ACCESS_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`                                                             | Identity access token verification; signing secret must be protected.          |
| `REDIS_URL`                                                                                                   | Shared technical infrastructure endpoint; protect any embedded credentials.    |
| `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `SQS_QUEUE_NAME` | Infrastructure configuration; AWS credentials are secrets.                     |
| `AI_PORT`, `SERVICE_NAME`, `NODE_ENV`, `LOG_LEVEL`                                                            | HTTP listener, service identity, environment and log verbosity.                |
| `SWAGGER_ENABLED`, `SWAGGER_PATH`                                                                             | Optional API documentation.                                                    |

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm db:migrate
pnpm build
docker compose up -d --build ai-service productivity-service
curl --fail http://localhost:3003/health
curl --fail http://localhost:3003/health/provider
```

Use the configured host ports if Compose overrides the defaults. Review migration
status before troubleshooting application startup. A running process alone does
not prove that its database or provider is healthy.

For local inference follow [Ollama setup](ai-ollama.md). Pull the exact configured
model and choose a model that supports tool calls for chat actions. Configure
[Cloudflare](ai-cloudflare.md) explicitly when desired. Switching providers requires
changing configuration and restarting AI. Quota exhaustion must not trigger a paid
fallback or unlimited retry loop.

## Chat and confirmed actions

```bash
curl --fail-with-body http://localhost:3003/ai/chat \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'x-correlation-id: manual-chat-001' \
  -d '{"prompt":"Tạo task đọc sách","timezone":"Asia/Ho_Chi_Minh"}'
```

To continue, send the returned `conversationId` with the next prompt. Read tools
can execute during chat. Write tools return `pendingActions`; inspect the proposed
payload before confirming. Copy `actionId` and `payloadHash` from that response:

```bash
curl --fail-with-body "http://localhost:3003/ai/actions/$ACTION_ID/confirm" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"payloadHash\":\"$PAYLOAD_HASH\"}"
curl --fail-with-body "http://localhost:3003/ai/actions/$ACTION_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Confirm currently returns HTTP 201. Repeating confirmation of the same action
returns its persisted result and does not repeat the write. A new proposed action
has a new identity; identical wording alone does not deduplicate separate actions.
See [action contract](ai-actions.md), [read tools](ai-read-tools.md),
[conversation API](ai-conversations.md) and [audit events](ai-events-audit.md).

The user's timezone must be explicit for calendar and date-sensitive writes. AI
cannot select another user ID or forward model-supplied credentials. Unknown tools
and additional input fields are rejected. An invalid timezone tool call is returned
to the model as a tool error so it can request clarification.

## Errors, retries and interrupted execution

Provider offline, invalid credentials, malformed responses, timeouts and Cloudflare
quota failures have stable application error codes. Inspect the code and provider
health before retrying. Provider retries are bounded by configuration; inference
requests may consume quota again on retry. Never retry a Productivity write after
an ambiguous timeout automatically.

Concurrent confirms claim the same database action atomically. Recovery expires
pending actions and terminates interrupted execution after its grace period. If
Productivity committed a write before the connection failed, an action may be
marked failed even though the resource exists. Inspect the resource through its
owner's Productivity API before creating a replacement. Productivity does not
currently implement a durable idempotency-key store, so this is not a guarantee of
exactly-once delivery across process failures.

`x-correlation-id` is returned on HTTP responses and forwarded to Productivity and
outbox envelopes. Supplied IDs accept 1–128 characters from letters, digits,
periods, underscores, colons and hyphens; other values are replaced with a UUID.
Search logs and audit envelopes by this ID. Avoid logging prompts, authorization
headers, API tokens or raw provider payloads. Latency uses a monotonic clock.

Outbox rows are durable audit records in this phase. Inspect `eventType`,
`occurredAt`, envelope correlation and `processedAt`; do not assume that persisting
an outbox row means an external consumer has received it.

## Verification

Use separate migrated PostgreSQL test databases, never production databases:

```bash
export DATABASE_URL='postgresql://lifehelper:lifehelper@localhost:5432/lifehelper_ai_test'
export PRODUCTIVITY_DATABASE_URL='postgresql://lifehelper:lifehelper@localhost:5432/lifehelper_productivity_test'
pnpm --filter @lifehelper/ai-service db:migrate
DATABASE_URL="$PRODUCTIVITY_DATABASE_URL" pnpm --filter @lifehelper/productivity-service db:migrate
pnpm --filter @lifehelper/ai-service test
pnpm --filter @lifehelper/ai-service test:e2e
pnpm --filter @lifehelper/ai-service test:persistence
pnpm --filter @lifehelper/ai-service test:workflow
```

`test:workflow` starts an isolated Productivity HTTP process, uses its real
application and database, and replaces only inference with a deterministic
provider. Each service cleans its own synthetic fixtures. CI runs this suite after
both services' migrations. No live inference runs in ordinary CI.

| Required scenario                          | Verification                                                         |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Persisted chat and bounded continuation    | conversations integration, bounded-context unit tests, HTTP workflow |
| Today's tasks                              | HTTP workflow and timezone registry unit tests                       |
| Task creation and duplicate confirms       | actions integration and HTTP workflow                                |
| Calendar timezone                          | HTTP workflow and write validation unit tests                        |
| Unknown/malformed tools                    | registry and conversation tests                                      |
| Cross-user conversations/resources/actions | conversations/actions integration and HTTP workflow                  |
| Ollama offline                             | provider unit tests and generation HTTP tests                        |
| Cloudflare unavailable/quota               | provider/router unit tests and Cloudflare HTTP tests                 |
| Correlation AI → Productivity              | HTTP workflow including generated response ID and audit envelope     |
| Audit/outbox timestamps                    | persistence/actions integration and HTTP workflow                    |

Live smoke checks are opt-in, with explicit provider configuration in the shell:

```bash
# Local model must already be pulled; this sends one inference request.
AI_MODEL=llama3.2 AI_BASE_URL=http://localhost:11434 \
  pnpm --filter @lifehelper/ai-service test:ollama-smoke
# Reads AI_MODEL, AI_BASE_URL, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
# Sends one request that can consume your account's quota.
pnpm --filter @lifehelper/ai-service test:cloudflare-smoke
```

## Persistence indexes and scope

Current query shapes are covered by conversation `(userId, updatedAt)`, message
`(conversationId, createdAt, id)`, action `(userId, createdAt)`,
`(userId, status, expiresAt)` and `(conversationId, createdAt)`, and outbox
`(processedAt, occurredAt)` indexes. Action claims use the primary key with a status
condition. The recovery worker scans expired statuses across users, so this branch adds
`(status, expiresAt)` for that actual predicate. The existing user-led index
continues to serve per-user action queries. Validate execution plans on
representative data with `EXPLAIN (ANALYZE, BUFFERS)` when monitoring growth.

Voice, Vision and RAG remain deferred contracts. This phase adds no audio/image
processing pipeline, embeddings, retrieval, streaming, vector storage or external
audit delivery worker. Provider support for tools varies by configured model.
