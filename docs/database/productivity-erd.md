# Productivity database

Owns tasks/subtasks/tags, calendar events, habits/schedules/logs, reminders, and outbox events.

```text
Task 1 ── * Subtask
Task * ── * Tag (TaskTag)
Habit 1 ── * HabitSchedule
Habit 1 ── * HabitLog
```

Child relations cascade; `userId` and reminder resource IDs are logical references without cross-service foreign keys. Composite uniqueness protects task tags, user tags, and dated habit logs. User/status/due-time and user/date indexes match expected lists and schedulers. Domain invariants also have SQL checks. Seed is deterministic and idempotent.
