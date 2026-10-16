# Notification foundation verification and migration

Branch 1 adds persistence capabilities; there is no new public HTTP endpoint or FCM
send yet. Existing `/health/live` and `/health/ready` remain available. There is no
manual Swagger push test for this branch.

## Local verification

With the existing PostgreSQL Docker container running, from the repository root:

```bash
pnpm --filter @lifehelper/notification-service prisma:generate
pnpm --filter @lifehelper/notification-service prisma:validate
pnpm architecture:check
pnpm architecture:test
pnpm --filter @lifehelper/notification-service lint
pnpm --filter @lifehelper/notification-service exec tsc --noEmit --incremental false
pnpm --filter @lifehelper/notification-service exec tsc -p test/tsconfig.json
pnpm --filter @lifehelper/notification-service test --runInBand
pnpm --filter @lifehelper/notification-service test:e2e --runInBand
pnpm --filter @lifehelper/notification-service build
python3 scripts/verify-notification-persistence.py
```

The Python script privately reads credentials/host port from the local PostgreSQL
container (`--postgres-container` overrides its name). It creates random dedicated test
DBs and drops only those it successfully created in `finally`, including failed runs.
It never migrates an application DB. Interrupt normally with Ctrl+C rather than killing
the process so cleanup can finish. A forced OS kill cannot guarantee finally executes;
if cleanup fails the script reports the exact owned database name for explicit cleanup.

The suite covers clean migrations, concurrent intake/claim, receipt rollback, stale
lease fencing, bounded crash retries, ownership, terminal states, expiry/cancellation,
unique/local foreign keys, reading independently from push, legacy upgrade and atomic
failure on duplicated legacy source events. CI's existing persistence job discovers the
new integration suite, with no network provider calls. The Python upgrade matrix is a
local Docker check; routine CI continues using the PostgreSQL service database.

## Deploying the additive migration

After reviewing the configured target and taking the normal database backup, deploy
with the service's existing `db:migrate` command. Never run `db:reset` on application data.
The new migration is `20261016000100_notification_dispatch_foundation`.

Before deployment, inspect historical duplicate events:

```sql
SELECT source_event_id, count(*)
FROM notifications
WHERE source_event_id IS NOT NULL
GROUP BY source_event_id HAVING count(*) > 1;
```

If duplicates exist the migration intentionally fails atomically. Reconcile which
records represent separate events with the operator/product owner; do not automatically
delete history, invent event IDs, or mark duplicated pushes as successful. Prisma may
surface a generic aborted-transaction error for this intentional preflight failure.
After explicit reconciliation and verification that the transaction rolled back,
mark this migration rolled back and redeploy:

```bash
pnpm --filter @lifehelper/notification-service exec prisma migrate resolve --rolled-back 20261016000100_notification_dispatch_foundation
pnpm --filter @lifehelper/notification-service db:migrate
```

Existing content, status and timestamps are preserved. `eligibleAt` and delivery
`nextAttemptAt` backfill from `createdAt`; unknown old failure times are not fabricated.
Legacy reminders receive no invented reminder/version identity, work or inbox receipts,
so deployment does not resend historical notifications. New writes use the safe payload
and reason policy; migration does not rewrite arbitrary historical JSON/provider errors.

Prefer forward recovery. Reverting the application after this additive migration does
not require dropping columns. Stop future dispatch workers before any deliberate rollback;
removing the new tables would destroy dedup/retry evidence and requires a separate
reviewed recovery plan. Do not simply remove the migration or change applied SQL.

Gemini remains an informational development review in the existing PR workflow. It is
not a runtime dependency or a merge decision made by Codex. A local verification run
is not evidence that Gemini/manual review or all seven Phase 6 branches are complete.
