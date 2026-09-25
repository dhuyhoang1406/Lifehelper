# Cloudflare Workers AI provider

AI Service remains on the backend; Flutter calls AI Service, not Cloudflare.
The adapter uses Cloudflare's authenticated Chat Completions endpoint. It does
not deploy an application to Cloudflare, enable billing, switch providers on
failure, or execute tools returned by a model.

Set these values in the root `.env` for Docker Compose, or in
`apps/ai-service/.env` when running AI Service directly:

```text
AI_PROVIDER=cloudflare
AI_MODEL=@cf/zai-org/glm-4.7-flash
AI_BASE_URL=https://api.cloudflare.com/client/v4
CLOUDFLARE_ACCOUNT_ID=<your account ID>
CLOUDFLARE_API_TOKEN=<Workers AI API token>
```

The example uses GLM-4.7-Flash for text generation and tool calling. Keep
`AI_MODEL` configurable rather than hardcoding it in the provider. Structured
JSON requests should be verified with the selected model before relying on
them in a business flow. Choose a model available on your plan that supports
the capabilities you need.
The API token and account ID must stay in local secret configuration, never in
source control, logs, requests from Flutter, or shared screenshots. AI Service
uses `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_CONTEXT_MESSAGES`, and
the bounded retry settings already documented in `.env.example`. Cloudflare
URLs must use HTTPS. A `429` with Cloudflare code `3036` means free allocation
is exhausted; code `3040` means temporary capacity pressure. The service
returns stable application errors and never falls back to a paid provider.

The existing authenticated `POST /ai/generate` endpoint accepts a `prompt`.
The provider port also supports tool definitions and structured JSON requests
for future orchestration; this branch does not add tool execution or a new
public API. JSON mode requires a compatible model and the adapter checks that
the returned content is parseable JSON, but does not claim full JSON Schema
validation.

## Switch between local Ollama and Cloudflare in Docker

For local Ollama on the host, set `AI_PROVIDER=ollama`, `AI_MODEL=llama3.2`, and
`AI_BASE_URL=http://host.docker.internal:11434` in the root `.env`. For
Cloudflare, use the five values shown above. After changing only `.env`,
recreate AI Service without rebuilding the image:

```bash
docker compose up -d --force-recreate --no-deps ai-service
```

Build AI Service once after changing its source code with
`docker compose up -d --build --no-deps ai-service`. When selecting Cloudflare,
do not include `docker-compose.ollama.yml`: that overlay forces
`AI_BASE_URL=http://ollama:11434` and would override the Cloudflare URL.
The API endpoint remains `POST /ai/generate`; check `metadata.provider` in its
response to confirm which provider served the request.

Run normal tests without Cloudflare credentials:

```bash
pnpm --filter @lifehelper/ai-service test
```

The opt-in online smoke test is excluded from routine CI. After setting the
five Cloudflare variables above in your shell, run:

```bash
pnpm --filter @lifehelper/ai-service test:cloudflare-smoke
```

Do not put real token values in a command line, script, or CI logs. A live
test consumes your account's Workers AI allowance. Run `/health/provider` to
check authenticated Cloudflare model-list access without inference; it does
not guarantee the selected model has available capacity.
