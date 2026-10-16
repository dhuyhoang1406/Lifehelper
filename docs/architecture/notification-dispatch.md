# Notification dispatch foundation (Phase 6, Branch 1)

Notification Service owns only its notification database. `userId`, `deviceSessionId`
and `sourceReminderId` are logical references; there are no foreign keys or reads into
Identity or Productivity databases. Domain and application contracts do not import
Prisma. `NotificationModule` composes the service-local adapters using one explicitly
imported `PrismaModule`.

## Decision: reuse history and persist a single dispatch per occurrence

The existing `notifications` and `notification_deliveries` tables remain the business
records. A non-null canonical `sourceEventId` is unique. New reminder intake also
requires `(sourceReminderId, dispatchVersion)` and expiry, with a unique occurrence
constraint so redelivery under a different event ID still reuses the same notification.
The original display content wins on replay; ownership/occurrence conflicts fail
without exposing the existing record to the caller.

`notification_inbox_records` records each `(consumer, eventId)` only after the local
transaction has persisted the notification and its durable work. This is an intake
receipt, distinct from the user-visible notification inbox. The receipt does not mean
FCM accepted a delivery. A later SQS consumer may acknowledge only after this commit.

A one-to-one `notification_dispatch_work` row is necessary because device targets are
unknown at intake and a user may have no targets. It carries attempts, next retry,
completion, immutable target-resolution time and a fenced lease. It is specific to
notification dispatch, not a general job framework. No scheduler/consumer is started by
this branch. Cancellation-before-intake watermarks and current reminder validity checks
belong to the later dispatch branch.

## State and time semantics

- Notification normally goes `PENDING -> PROCESSING -> SENT/FAILED`.
- Delivery goes `PENDING -> SENT/FAILED/SKIPPED`. A retry remains `PENDING` with a safe
  error code and next-attempt time. Terminal deliveries cannot be rewritten.
- Aggregate `SENT` means at least one device was accepted by FCM; other pending devices
  can still retry. It does not promise display or exactly-once delivery. Later FCM
  integration must account for a send succeeding before its local result commits.
- Resolved empty targets retain history and end push processing as `FAILED` with
  `NO_ACTIVE_DEVICE`. All terminal deliveries without acceptance produce `FAILED`.
- Cancellation/stale version/expiry persist suppression, skip pending deliveries and
  complete work. Previously accepted devices keep aggregate `SENT`. Suppression may
  terminalize pending work before target resolution; no replacement notification is
  created. Earlier provider acceptance cannot be undone.
- `readAt` is first-write-wins and independent from push status. Owner-scoped reads,
  stable bounded pagination and mark-read persistence are ready for the later inbox API.
- All persisted timestamps use `timestamptz`; eligibility is inclusive, expiry is
  exclusive. The repository uses PostgreSQL `clock_timestamp()` for leases and results.
  Input instants are normalized by PostgreSQL; JSON dates serialize as UTC. Scheduling
  IANA timezone conversion remains Productivity's responsibility.

Every managed writer locks the notification before work/deliveries. Claim uses
`FOR UPDATE ... SKIP LOCKED`, then rechecks the work row under that parent lock.
Lease tokens increase on each claim; stale/expired workers cannot resolve or settle.
The final clock check rolls back writes if a lease expires during the transaction.
External calls must happen outside transactions. Attempt count includes claims that
crash, bounding recovery even before device resolution. Each successful settle releases
its lease, so a repeated completion cannot increment delivery attempts twice.
The target list is captured once; later dispatch must revalidate those sessions/tokens
through Identity before sending. No raw token is stored in these tables.

Generic baseline save methods reject managed records and owner/target reassignment,
so callers cannot bypass dispatch fencing through an unconditional upsert. Internal
unscoped reads remain for service orchestration; public APIs must use owner methods.

## Content and configuration

New notification data is null or an allowlisted `{resourceType, resourceId}` reference
(`TASK`, `CALENDAR`, `HABIT`, `REMINDER`), not a URL, token or arbitrary command.
Title/body/data limits are validated configuration. Titles are capped at the database's
255 characters; body defaults to 4096 characters and data to 2048 UTF-8 JSON bytes.
New error writes accept only domain safe codes; provider error bodies are not persisted.
Historical JSON/errors are preserved by migration and restoration; future public DTOs
must sanitize historical payloads too.

Validated settings (no worker is enabled by these values):

| Variable                       | Default | Purpose                                    |
| ------------------------------ | ------: | ------------------------------------------ |
| `NOTIFICATION_TITLE_MAX_CHARS` |     255 | Display title bound                        |
| `NOTIFICATION_BODY_MAX_CHARS`  |    4096 | Display body bound                         |
| `NOTIFICATION_DATA_MAX_BYTES`  |    2048 | Resource-reference payload bound           |
| `NOTIFICATION_LEASE_MS`        |   60000 | Claim lease, maximum 300000                |
| `NOTIFICATION_RETRY_MS`        |   30000 | Fixed bounded retry delay, maximum 3600000 |
| `NOTIFICATION_MAX_ATTEMPTS`    |       8 | Maximum claims, including crash recovery   |
| `NOTIFICATION_MAX_TARGETS`     |     100 | Maximum resolved device sessions           |

The actual event contracts, Identity target client, SQS/outbox routing, scheduler, FCM,
HTTP inbox API and Flutter integration are deferred to the approved later branches.
There are no API/event contract changes or provider SDK dependencies in Branch 1.

References: [PostgreSQL row locking](https://www.postgresql.org/docs/17/explicit-locking.html),
[unique constraints and nullable keys](https://www.postgresql.org/docs/17/ddl-constraints.html),
[Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions).
