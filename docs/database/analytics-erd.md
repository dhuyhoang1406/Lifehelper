# Analytics database

Owns `DailyProductivityMetric`, `EventProcessingLog`, and `OutboxEvent`.

Daily metrics are unique by logical Identity `userId` and date. Event IDs are the idempotency key; consumer/time is indexed for operations. All metric and retry counters are non-negative. No cross-service foreign keys exist. Seeds and migrations are independently repeatable.
