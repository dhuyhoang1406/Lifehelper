# Identity authentication API

All endpoints accept and return JSON. Protected endpoints require
`Authorization: Bearer <access-token>`. Access tokens are short-lived JWTs;
refresh tokens are opaque, rotated on every use, and must be stored securely by
the mobile client.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register` | Create an account and device session |
| POST | `/auth/login` | Authenticate with email and password |
| POST | `/auth/oauth/google` | Authenticate with a Google ID token |
| POST | `/auth/refresh` | Rotate a refresh token |
| GET | `/auth/me` | Return the authenticated user's safe profile |
| POST | `/auth/logout` | Revoke the current device session |
| POST | `/auth/logout-all` | Revoke all device sessions |
| GET | `/auth/sessions` | List device sessions |
| DELETE | `/auth/sessions/:sessionId` | Revoke an owned device session |

Register and login requests include a `device` object with `deviceId`,
`platform` (`ANDROID`, `IOS`, or `WEB`), and optional `deviceName`. Google login
accepts the ID token issued to `GOOGLE_CLIENT_ID`; profile fields sent separately
by a client are never trusted.

Errors use a stable `code`, HTTP `statusCode`, human-readable `message`, and
`correlationId` when one is present. Clients should branch on `code`, not message.

Required production configuration is documented in
`apps/identity-service/.env.example`. Secrets must be supplied by the deployment
environment and never committed.
