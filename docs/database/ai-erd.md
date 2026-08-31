# AI database

```text
Conversation 1 ── * Message
Conversation 1 ── * AIActionLog
Message 1 ── * AIActionLog
```

Conversation deletion cascades messages; optional audit references become null to preserve history. `userId` is a logical Identity reference. User/time and conversation/time indexes support history queries. Token/duration counters are constrained non-negative. Outbox dispatch is intentionally outside this phase.
