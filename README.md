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

Readiness checks verify the service's PostgreSQL connection. LocalStack creates the `lifehelper-local` S3 bucket plus the `lifehelper-events` queue and its dead-letter queue automatically.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm prisma:validate
```

Each backend service has its own Prisma schema and PostgreSQL database. Requests accept or generate an `x-correlation-id`; the same value is returned in the response and included in structured JSON logs.

## Flutter

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

Android emulators use `10.0.2.2` to reach the host. For iOS simulators or desktop/web, pass `http://localhost:3001` instead.

## Pull request quality gates

Pull requests into `dev` receive an automatic AI review powered by Google Gemini
(free tier). A developer evaluates the findings and pushes any fixes before
manually starting **Technical Verification** from the GitHub Actions page for the
pull request branch. Pushing a fix starts a fresh AI review; it does not start CI.

The repository administrator must configure the following outside this repository:

1. Add `GEMINI_API_KEY` as a repository Actions secret (Settings → Secrets and
   variables → Actions). Create a free key at Google AI Studio
   (https://aistudio.google.com/apikey). Do not add the value to repository files.
2. Create a ruleset for `dev` that restricts deletion and force pushes and requires
   a pull request. Require the `Backend quality checks` and `Flutter quality checks`
   statuses from the **Technical Verification** workflow.
3. Keep the AI review informational; do not configure it as a required status
   check. After review is satisfactory, run CI from Actions and select the PR's
   feature branch so the checks attach to its current head commit.
