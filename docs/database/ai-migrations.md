# AI database migrations

The AI service owns the `lifehelper_ai` database and its Prisma migration
history. Apply committed migrations from the workspace root with:

```bash
pnpm --filter @lifehelper/ai-service db:migrate
```

Production migrations are forward-only. Before deployment, take a PostgreSQL
backup and verify it can be restored. If a migration fails before completion,
fix the migration or environment and rerun `prisma migrate deploy`. If it was
manually recovered, use `prisma migrate resolve --rolled-back <migration>` only
after confirming the database matches the pre-migration schema.

Do not edit an already deployed migration. Create a compensating migration for
schema rollback, then deploy it through the normal pipeline. Local disposable
databases may be rebuilt with `pnpm --filter @lifehelper/ai-service db:reset`;
this command is destructive and must never be used against shared or production
databases.
