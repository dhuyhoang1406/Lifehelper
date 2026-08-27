# Domain Entity Catalog

This catalog mirrors the Phase 0 V1 system design. It describes domain ownership; persistence mapping and the physical ERD belong to Phase 1.6.

## Identity Service

| Entity | Purpose and important fields | Relations | Invariants / behavior |
| --- | --- | --- | --- |
| `User` | Account/profile: email, optional password hash/avatar, display name, status, verification/login timestamps, soft delete | Owns OAuth accounts and device sessions | Normalized email; required email/display name; status-controlled suspend/delete |
| `OAuthAccount` | External identity: provider, provider user ID, optional provider email | Belongs to user by `userId` | Provider user ID is required; `(provider, providerUserId)` is unique in persistence |
| `DeviceSession` | Managed login device: device ID/name, platform, optional push token, activity/revocation timestamps | Belongs to user; owns refresh tokens | Revoked sessions cannot record activity; `(userId, deviceId)` is unique in persistence |
| `RefreshToken` | Hashed rotating token: family, expiry, use/revocation/replacement timestamps | Belongs logically to user and device session | Must initially expire in the future; used, revoked, or expired tokens cannot rotate |

## Productivity Service

| Entity | Purpose and important fields | Relations | Invariants / behavior |
| --- | --- | --- | --- |
| `Task` | User task: title, optional description/due date/estimate, status, priority, completion and soft-delete timestamps | Owns subtasks; many-to-many tags via TaskTag; logical `userId` | Estimate is positive when present; completed status and timestamp agree; controlled start/complete/reopen/cancel transitions |
| `Subtask` | Ordered task item: title, position, completion state | Belongs to task | Position is non-negative; complete/reopen maintains `completedAt` |
| `Tag` | User-scoped task label | Many-to-many tasks via TaskTag; logical `userId` | Non-empty name up to 80 characters; `(userId, name)` is unique in persistence |
| `TaskTag` | Explicit task/tag association | Belongs to task and tag | Composite identity `(taskId, tagId)` |
| `CalendarEvent` | Timezone-aware event: title/type, time range, optional location/description/RRULE, soft delete | Logical `userId` | End is strictly after start; timezone is required and supplied externally |
| `Habit` | Repeatable activity: frequency, target, date range, active and soft-delete state | Owns schedules and logs; logical `userId` | Target ≥ 1; end date does not precede start date; deleted habits cannot reactivate |
| `HabitSchedule` | Optional weekday/time slot for a habit | Belongs to habit | Weekday is null or 1–7 |
| `HabitLog` | Dated habit check-in and completed count | Belongs to habit; logical `userId` | Completed count ≥ 1; `(habitId, logDate)` is unique in persistence |
| `Reminder` | Timezone-aware reminder optionally linked to a resource | Logical `userId` and optional cross-domain `resourceId` | Non-custom reminders require a resource; controlled queue/send/fail/cancel transitions |

## AI Service

| Entity | Purpose and important fields | Relations | Invariants / behavior |
| --- | --- | --- | --- |
| `Conversation` | User chat thread with optional title and soft delete | Owns messages; logical `userId` | Identity and owner are immutable |
| `Message` | Conversation message: role/content, optional model and token usage | Belongs to conversation | Content required; token counts are non-negative when present |
| `AIActionLog` | Tool-call audit: dynamic input/output, status, optional error/duration | Optionally references conversation/message; logical `userId` | Tool name required; duration non-negative; explicit success/fail/reject behavior |

## Document Service

| Entity | Purpose and important fields | Relations | Invariants / behavior |
| --- | --- | --- | --- |
| `Document` | User-owned S3 metadata, MIME type, size/checksum, processing status/error, soft delete | Owns chunks; logical `userId` | Size ≥ 0; storage metadata required; upload/processing/ready transitions protected |
| `DocumentChunk` | Indexed extracted text with optional token count and metadata | Belongs to document; owns at most one embedding | Index and token count are non-negative; `(documentId, chunkIndex)` is unique in persistence |
| `DocumentEmbedding` | Model-specific vector for one chunk | Belongs one-to-one to chunk | Model required; vector must be non-empty and finite |

## Notification Service

| Entity | Purpose and important fields | Relations | Invariants / behavior |
| --- | --- | --- | --- |
| `Notification` | User notification history: type, title/body, dynamic data, source event and lifecycle timestamps | Owns deliveries; logical `userId` | Title/body required; controlled processing/sent/failed behavior |
| `NotificationDelivery` | Per-device provider delivery attempt and outcome | Belongs to notification; logical `deviceSessionId` only | Attempt count ≥ 0; records provider message, failure, skip and timestamps; pair is unique in persistence |

## Analytics Service

| Entity | Purpose and important fields | Relations | Invariants / behavior |
| --- | --- | --- | --- |
| `DailyProductivityMetric` | Daily projection counters for tasks, habits, calendar and AI usage | Logical `userId` | Counters never negative; increments are positive integers; `(userId, metricDate)` is unique in persistence |
| `EventProcessingLog` | Idempotent consumer receipt: event type, consumer and processing time | Identified by external `eventId` | Event type and consumer required |

## Boundary rules

- Cross-service references are UUID values only; no service imports another service's entities.
- Only `UUID` and `JsonValue` are shared technical primitives.
- Domain code has no NestJS, Prisma, AWS, Redis, OpenAI, HTTP, or persistence dependencies.
- Dates represent UTC timestamps internally. Calendar events and reminders retain the caller-provided IANA timezone.
