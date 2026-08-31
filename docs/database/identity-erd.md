# Identity database

Owns `User`, `OAuthAccount`, `DeviceSession`, `RefreshToken`, and `OutboxEvent`.

```text
User 1 ── * OAuthAccount
User 1 ── * DeviceSession 1 ── * RefreshToken
User 1 ── * RefreshToken
```

OAuth provider identity, email, device-per-user, and token hash are unique. Internal children cascade with their owner. User status/session and token-family indexes support authentication queries. Token expiry and non-negative outbox attempts are database constraints. Seed uses centralized deterministic demo UUIDs and upserts.
