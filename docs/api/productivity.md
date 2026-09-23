# Productivity service

The productivity service owns tasks, subtasks, tags, calendar events, habits,
habit schedules, habit logs, and reminders. Every request is authenticated and
every resource lookup is scoped by the JWT subject. A resource owned by another
user is returned as not found; the service never queries the identity database to
revalidate that subject.

## API surface

| Resource   | Endpoints                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------- |
| Tasks      | `POST/GET /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/{complete,reopen,cancel}` |
| Subtasks   | `POST /tasks/:id/subtasks`, `PATCH/DELETE /tasks/:id/subtasks/:subtaskId`                    |
| Tags       | `POST/GET /tags`, `PATCH/DELETE /tags/:id`, `POST/DELETE /tasks/:id/tags/:tagId`             |
| Calendar   | `POST/GET /calendar-events`, `GET/PATCH/DELETE /calendar-events/:id`                         |
| Habits     | `POST/GET /habits`, `GET/PATCH/DELETE /habits/:id`, `POST /habits/:id/{pause,resume}`        |
| Habit logs | `POST/GET /habits/:id/logs`, `PATCH /habits/:id/logs/:logId`                                 |
| Reminders  | `POST/GET /reminders`, `GET/PATCH/DELETE /reminders/:id`, `POST /reminders/:id/cancel`       |

## Task lifecycle

Tasks start in `TODO`. They may be completed or cancelled; completed tasks may
be reopened. The domain rejects invalid transitions and keeps `status` and
`completedAt` consistent. Subtasks and tags are independently owned through the
parent task or authenticated user.

## Calendar rules

Calendar instants are stored as PostgreSQL `timestamptz` values and therefore
normalized to UTC. The supplied IANA timezone is preserved for display and
future scheduling. `endAt` must be after `startAt`. Range queries require both
`from` and `to`, use overlap semantics, and are executed in PostgreSQL.

## Habit model

Habit frequency and schedule replacement rules are documented in
[productivity-habits.md](./productivity-habits.md). Habit lifecycle operations
pause, resume, and archive the aggregate. A habit log belongs to both the habit
and authenticated user, and the database enforces one log per habit and local
date with `UNIQUE(habit_id, log_date)`.

## Reminder model

A reminder may reference a task, calendar event, or habit through the logical
`resourceType`/`resourceId` pair. Reference validation is owner-scoped and does
not introduce cross-service foreign keys. `CUSTOM` reminders have no resource.
This service persists and cancels reminders; notification delivery is outside
this phase.

## Pagination and filters

List endpoints use one-based `page` and bounded `limit` query parameters. The
maximum limit is 100. Tasks support status, priority, due date, tag, search, and
sorting. Calendar events support an optional complete date range. Habits support
active state. Habit logs and reminders support date ranges; reminders also
support status. Filtering, sorting, counting, and pagination run in PostgreSQL,
not after loading unbounded rows into Node.js.

## Errors

Application failures use stable codes such as `TASK_NOT_FOUND`,
`TAG_ALREADY_EXISTS`, `CALENDAR_EVENT_NOT_FOUND`, `HABIT_NOT_FOUND`, and
`REMINDER_NOT_FOUND`. Responses include `statusCode`, `code`, `message`, and the
request `correlationId`. Domain invariant failures use `VALIDATION_ERROR`;
unexpected failures return a generic `INTERNAL_SERVER_ERROR` and are logged
server-side without exposing internal details.

## Database ownership

Only productivity-service connects to `productivity_db`. User IDs and logical
resource IDs are scalar UUIDs, not cross-service foreign keys. Prisma remains in
the persistence layer; domain entities contain no NestJS or Prisma imports.
