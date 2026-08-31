# Persistence operations

Each service owns its schema and migration history. From the workspace root run `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:seed`. `pnpm db:reset` is destructive and intended only for local databases.

Migrations use `prisma migrate deploy` and never infer schema changes at service startup. Seeds use fixed identifiers from `@lifehelper/shared-types`, contain no credentials, and are safe to rerun. Cross-service IDs remain logical references. Business writes and outbox inserts can share the small per-service Prisma transaction runner; SQS dispatch is deferred.
