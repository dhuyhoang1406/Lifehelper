# AI events and audit (Phase 4, Branch 8)

AI Service writes a local transactional outbox in `lifehelper_ai.outbox_events`.
Publishing/Analytics consumption is not enabled in this branch. The shared
`EventEnvelope` (`version: 1`) is stored in `payload`; the outbox row repeats
its event type and UTC `occurredAt` for querying.

| Event              | Aggregate    | Trigger                                                                              |
| ------------------ | ------------ | ------------------------------------------------------------------------------------ |
| `ai.requested`     | conversation | User message persisted                                                               |
| `ai.completed`     | conversation | Assistant message persisted                                                          |
| `ai.failed`        | conversation | Provider request failed                                                              |
| `ai.requested`     | action       | Pending write action persisted                                                       |
| `ai.tool.executed` | action       | Confirmed write completed                                                            |
| `ai.failed`        | action       | Confirmed write failed, expired, was rejected, or had an unknown interrupted outcome |

Events carry a request `correlationId`. Action records also store their initial
correlation ID so the recovery sweep can emit correlated failure events. Each
message/action insert or state update and its matching outbox insert run in one
PostgreSQL transaction. External provider and Productivity requests run outside
these transactions.

Event payloads contain IDs, tool name, selected enums/timezone, provider/model,
token counts, monotonic duration and normalized error code as applicable.
The per-tool allowlist in `ai-audit-events.ts` excludes titles, descriptions,
prompts, authorization headers, API tokens and full Productivity responses.
Pending action inputs remain in `AIActionLog.inputPayload` because confirmation
must execute the immutable proposal; the action API is owner-scoped. Successful
Productivity output is reduced to resource ID and optional status.

The two Branch 8 migrations add nullable usage and correlation columns to
`ai_action_logs` and can be deployed with `pnpm --filter @lifehelper/ai-service
db:migrate`. For rollback, take a database backup and use a forward migration
that drops only these new columns after confirming no audit data needs retention.
Do not reset the production database to roll back this feature.
