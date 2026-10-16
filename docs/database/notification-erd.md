# Notification database

```text
Notification 1 ── * NotificationDelivery
             1 ── * NotificationInboxRecord
             1 ── 0..1 NotificationDispatchWork
```

`Notification` owns user history and independent `readAt`. Canonical source events are
unique when present; reminder/version identifies one logical dispatch. Nullable legacy
identity is preserved, but new reminder intake requires event, occurrence and expiry.
User/time/id supports stable owner pagination. Identity and Productivity IDs are logical
references only, with no cross-service foreign keys.

`NotificationDelivery` tracks one logical device session per notification (unique
pair), acceptance reference, safe error, attempts and sent/failed/skipped/retry times.
It stores no push token. Delivery history cascades with a notification, while inbox/work
rows restrict deletion so durable work cannot disappear through a history delete.

`NotificationInboxRecord` deduplicates transport intake by consumer/event. It is not the
user inbox. `NotificationDispatchWork` is one dispatch's durable retry/lease state before
and after device resolution. Both have only local notification foreign keys. A completed
work row cannot hold a lease; lease owner/expiry must be present together. Attempt/token
counters are non-negative. Baseline seed still upserts one SYSTEM notification.

See [dispatch state and architecture](../architecture/notification-dispatch.md) and
[migration/verification runbook](../runbooks/notification-persistence.md).
