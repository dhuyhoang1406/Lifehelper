# Local Ollama provider

AI Service calls Ollama internally. Flutter calls AI Service, never Ollama. The
`POST /ai/generate` endpoint requires an Identity access token. It accepts one
`prompt` and returns the provider-neutral response; conversation persistence and
tool execution are outside this endpoint.

## Run AI Service directly

1. Start PostgreSQL and the existing local infrastructure. Copy
   `apps/ai-service/.env.example` to `apps/ai-service/.env` and set its
   `JWT_ACCESS_SECRET` to the same value used by Identity Service.
2. Start Ollama locally in one terminal, then pull the configured model in
   another terminal:

   ```bash
   ollama serve
   # In a second terminal:
   ollama pull llama3.2
   ```

   If Ollama is already running as a system service, skip `ollama serve`.

3. Start AI Service:

   ```bash
   pnpm --filter @lifehelper/ai-service start:dev
   ```

## Run Ollama inside Docker Compose

The optional overlay gives Ollama a private Compose network address and does
not publish port 11434. It is not part of normal CI or the default Compose run.

```bash
docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.ollama.yml exec ollama ollama pull llama3.2
```

Set `AI_MODEL` in the root `.env` to the model you pulled. The overlay sets
`AI_BASE_URL=http://ollama:11434` for AI Service. When running Ollama on the
host instead, use the base Compose file and ensure Ollama listens on a host
address reachable by Docker; restrict port 11434 to the local Docker network.

## Verify

Use a valid Identity access token (for example one returned by login):

```bash
curl http://localhost:3003/health/provider
curl -X POST http://localhost:3003/ai/generate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hello in one sentence"}'
```

`/health/ready` checks the database. `/health/provider` checks Ollama and the
configured model. Automated tests use a fake provider and stub HTTP server;
they do not need a local model.
