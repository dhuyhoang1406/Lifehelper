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
pnpm build
pnpm test
pnpm test:e2e
```

Each backend service has its own Prisma schema and PostgreSQL database. Requests accept or generate an `x-correlation-id`; the same value is returned in the response and included in structured JSON logs.

## Flutter

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

Android emulators use `10.0.2.2` to reach the host. For iOS simulators or desktop/web, pass `http://localhost:3001` instead.
