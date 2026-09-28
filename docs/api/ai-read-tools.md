# AI read tools (Branch 6)

`POST /ai/chat` can use the following registered, read-only tools when the selected
provider requests them:

| Tool | Productivity API | Arguments |
| --- | --- | --- |
| `get_tasks` | `GET /tasks` | Optional `page` (1–100), `limit` (1–20), `status`, `search` (up to 100 characters) |
| `get_today_tasks` | `GET /tasks` with DB-backed `dueFrom`/`dueTo` | Required IANA `timezone`; optional `limit` (1–20) |
| `get_schedule` | `GET /calendar-events` | Required ISO-8601 `from`/`to` timestamps with offsets and IANA `timezone`; optional `limit` (1–50). Range is at most 31 days. |

`get_productivity_summary` is not registered because Productivity Service has no
summary API yet. Unknown tool names and extra arguments (including a model-supplied
`userId`) are rejected before any downstream call. The AI Service forwards only
the Identity access token already verified for the chat request, plus its
`x-correlation-id`; Productivity Service performs its own token verification and
owner-scoped queries. Model-visible responses include only the task/calendar
fields needed to answer, not full resource records or raw upstream errors.

For prompts about "today" or another relative date, clients should send an IANA
`timezone` in the `/ai/chat` request body (for example `Asia/Ho_Chi_Minh`).
The AI Service validates it and provides the current UTC time and timezone to
the model. Without timezone context, the model should ask the user rather than
guess a default timezone.

The registry validates arguments at runtime, not merely through the provider's
tool schema. At most two tool rounds and three calls per round are accepted.
The assistant tool-call message and its tool-result messages are saved together
in one PostgreSQL statement. A downstream failure is represented by a stable
error code in the tool result; raw errors are never sent to the model.

Configuration: `PRODUCTIVITY_SERVICE_URL` is the internal service origin and
`PRODUCTIVITY_TIMEOUT_MS` bounds each downstream read. For Docker Compose, the
default is `http://productivity-service:3002`; for a locally run AI Service,
use `http://localhost:3002`. There is no direct AI-to-Productivity database
access, no write tool, and no summary tool in this branch.
