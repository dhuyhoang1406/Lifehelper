# AI productivity actions (Branch 7)

The AI Service exposes seven write tools: `create_task`, `update_task`,
`complete_task`, `create_calendar_event`, `create_reminder`, `create_habit`,
and `log_habit`. The model can only propose an action. All seven writes require
an explicit, separate user confirmation. Read tools remain available without
confirmation.

Tool classification is explicit: read tools are `READ_ONLY`; create and log tools
are `WRITE_LOW_RISK`; task update and completion are
`SENSITIVE_OR_DESTRUCTIVE`. This V1 confirmation policy still requires
confirmation for every write.

1. Call `POST /ai/chat` with a prompt and an IANA `timezone` for time-sensitive
   requests. The response includes `pendingActions`, each with `actionId`,
   validated `arguments`, `payloadHash`, `expiresAt`, and `status: REQUESTED`.
   No Productivity write has happened yet.
2. Show the exact pending arguments to the user. To approve, call
   `POST /ai/actions/{actionId}/confirm` with the same access token and
   `{"payloadHash":"<hash from pendingActions>"}`. To decline, call
   `POST /ai/actions/{actionId}/reject` with the same body.
3. `GET /ai/actions/{actionId}` returns the user's action status and sanitized
   output. It is owner-scoped; another user's action ID returns 404.

The tool result stored in conversation history records the original proposal.
When that conversation continues, AI Service adds a bounded, owner-scoped
summary of the latest action statuses from the audit table; it does not present
the old pending tool result as proof of execution.

Confirmations are accepted for ten minutes by default; configure this with
`AI_ACTION_CONFIRM_TTL_SECONDS` (60–3600). Each action has a server-generated
idempotency UUID and a database-backed, atomic `REQUESTED → EXECUTING` claim.
Concurrent or repeated confirmations never issue a second write. Once complete,
the action is `SUCCESS` or `FAILED`; rejected or expired requests are
`REJECTED`. If the AI process stops during an outbound write, the recovery
sweep eventually marks the action `FAILED` with
`AI_ACTION_OUTCOME_UNKNOWN` and **never replays it**. This status means the
client should inspect the resource before proposing a new action: the remote
write may have completed before the process stopped.

Time arguments require explicit ISO-8601 timestamps with UTC offsets. Calendar
events require `endAt > startAt`; calendar/reminder timestamps must agree with
the supplied IANA timezone (including daylight-saving changes). The timestamp
is sent to Productivity, which persists the instant in PostgreSQL and enforces
its own domain and ownership rules. No provider-generated `userId` is accepted.
AI Service forwards the verified access token and `x-correlation-id` to
Productivity Service over its internal HTTP URL; raw upstream errors and tokens
are not stored in action logs or shown to the model.

Local PostgreSQL test: run the AI migration, then
`pnpm --filter @lifehelper/ai-service test:persistence` with
`DATABASE_URL` pointing at the AI test database. Unit tests cover schemas,
timezone and controlled HTTP adapter contracts. HTTP integration tests use a
real AI PostgreSQL database and a deterministic Productivity client; they do
not create resources in a developer's Productivity database.
