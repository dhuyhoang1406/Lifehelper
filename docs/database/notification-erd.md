# Notification database

```text
Notification 1 ── * NotificationDelivery
```

Delivery rows cascade with notification history and are unique per logical Identity `deviceSessionId`. Status/time indexes support workers; user/time supports history. Identity data is never joined or foreign-keyed. Attempt counters are constrained non-negative. Seed upserts one deterministic notification.
