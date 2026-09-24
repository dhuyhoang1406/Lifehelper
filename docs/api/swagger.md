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

Use the **Authorize** button to supply an access token issued by identity-service.
Tokens and credentials are never embedded in the OpenAPI document. Productivity
write endpoints include safe example payloads for Swagger's **Try it out** flow;
executing them writes to the configured local database just like a normal API
request.

Swagger documents HTTP APIs only. Asynchronous SQS contracts remain documented
and versioned in the event-contract package rather than being represented as
HTTP operations.
