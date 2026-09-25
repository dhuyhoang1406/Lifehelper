# Backend Swagger UI

Each HTTP microservice owns an independent OpenAPI document. Swagger is enabled
only when `SWAGGER_ENABLED=true`; production can leave it unset or set it to
`false`. `SWAGGER_PATH` defaults to `docs`.

With the example local ports, the UIs are available at:

- Identity: `http://localhost:3001/docs`
- Productivity: `http://localhost:3002/docs`
- AI: `http://localhost:3003/docs`
- Document: `http://localhost:3004/docs`
- Notification: `http://localhost:3005/docs`
- Analytics: `http://localhost:3006/docs`

## Try a request locally

1. Open Identity Swagger at `http://localhost:3001/docs`, expand
   `POST /auth/register`, then use **Try it out** and **Execute**. The request
   body includes a sample email, password and device. Change the email if that
   sample account already exists. The sample password is only a documentation
   value; never reuse it for a real account.
2. The register response contains `accessToken` and `refreshToken`. You can
   alternatively call `POST /auth/login` with the same credentials and its
   provided JSON example. The seeded demo account has no password and cannot
   be used for password login.
3. In Identity or Productivity Swagger, click **Authorize** and paste the
   `accessToken` value (without the `Bearer ` prefix). Then use **Try it out**
   on protected endpoints. Do not paste a refresh token into Authorize.
4. For `POST /auth/refresh`, replace the example placeholder with the real
   `refreshToken`. A refresh rotates the token; use the newly returned values
   afterwards. Google login also needs a real Google ID token, not its
   placeholder.

Productivity create endpoints include example bodies. For endpoints with an
`:id` parameter, use an ID returned by a preceding create request. Executing
**Try it out** writes to the configured database just like a normal API call.
Tokens and real credentials are never embedded in the OpenAPI document.

Swagger documents HTTP APIs only. Asynchronous SQS contracts remain documented
and versioned in the event-contract package rather than being represented as
HTTP operations.
