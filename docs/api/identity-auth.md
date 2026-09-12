# Identity authentication API

All endpoints accept and return JSON. Protected endpoints require
`Authorization: Bearer <access-token>`. Access tokens are short-lived JWTs;
refresh tokens are opaque, rotated on every use, and must be stored securely by
the mobile client.

| Method | Path                        | Purpose                                      |
| ------ | --------------------------- | -------------------------------------------- |
| POST   | `/auth/register`            | Create an account and device session         |
| POST   | `/auth/login`               | Authenticate with email and password         |
| POST   | `/auth/oauth/google`        | Authenticate with a Google ID token          |
| POST   | `/auth/refresh`             | Rotate a refresh token                       |
| GET    | `/auth/me`                  | Return the authenticated user's safe profile |
| POST   | `/auth/logout`              | Revoke the current device session            |
| POST   | `/auth/logout-all`          | Revoke all device sessions                   |
| GET    | `/auth/sessions`            | List device sessions                         |
| DELETE | `/auth/sessions/:sessionId` | Revoke an owned device session               |

Register and login requests include a `device` object with `deviceId`,
`platform` (`ANDROID`, `IOS`, or `WEB`), and optional `deviceName`. Google login
accepts the ID token issued to `GOOGLE_CLIENT_ID`; profile fields sent separately
by a client are never trusted.

Errors use a stable `code`, HTTP `statusCode`, human-readable `message`, and
`correlationId` when one is present. Clients should branch on `code`, not message.

Revocation takes effect immediately for both refresh and access tokens. Every
protected request verifies that the JWT's `sessionId` still exists, belongs to
the token subject, and has not been revoked. Consequently, the access token used
for `/auth/logout` or `/auth/logout-all` receives `401 Unauthorized` on its next
protected request; clients should then discard both local tokens.

## Google OAuth smoke test

The regular unit and end-to-end suites mock Google's verifier and require no
external credentials. Before a release, an engineer can opt in to a live check
with a recently issued Google ID token whose audience is the configured web
client ID:

```bash
GOOGLE_CLIENT_ID='your-client-id.apps.googleusercontent.com' \
GOOGLE_ID_TOKEN='short-lived-id-token' \
pnpm --filter @lifehelper/identity-service test:oauth-smoke
```

Use only a disposable test account. ID tokens are short-lived secrets: pass the
token through the environment, never add it to `.env` files, shell scripts, CI
logs, source control, or screenshots. This live smoke test is intentionally not
part of CI because it depends on an interactive, expiring credential. A passing
test confirms Google signature, issuer, expiry, audience, email, and verified
email handling in the production provider.

Required production configuration is documented in
`apps/identity-service/.env.example`. Secrets must be supplied by the deployment
environment and never committed.
