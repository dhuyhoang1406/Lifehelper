# AI conversations (Branch 5)

All endpoints require the Identity access token. AI Service derives the user ID
from the verified token; callers cannot supply an owner ID.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/ai/chat` | Start or continue a conversation and persist both messages |
| GET | `/ai/conversations?page=1&limit=20` | List the user's active conversations |
| GET | `/ai/conversations/:id?page=1&limit=20` | Get a conversation and its oldest-first message page |
| DELETE | `/ai/conversations/:id` | Soft-delete a conversation (204) |

Start a conversation with `{ "prompt": "Xin chào" }`. Continue it by adding
`"conversationId": "<UUID returned by the first call>"`. A successful chat
response includes `conversationId`, `userMessageId`, `assistantMessageId`,
`content`, `usage`, `metadata` and the assistant `createdAt` timestamp.
Conversation and message pages contain `items`, `total`, `page` and `limit`;
the maximum page size is 100. Requests for another user's conversation return
`AI_CONVERSATION_NOT_FOUND` (404), the same as an unknown or deleted ID.

The user message is saved before the provider call. On provider failure it
remains in history, but no assistant success message is fabricated. Context is
loaded in a bounded, owner-scoped PostgreSQL query using
`AI_MAX_CONTEXT_MESSAGES`; the provider call runs outside any DB transaction.
All timestamps and IDs are generated server-side. This branch does **not**
enable tool execution, access Productivity data, or create tasks through chat;
those capabilities belong to the subsequent tool-registry/action branches.

The real PostgreSQL HTTP integration suite runs with
`pnpm --filter @lifehelper/ai-service test:persistence` after migrations are
applied and `DATABASE_URL` points to the AI database. Routine unit and HTTP
tests use a fake provider; they do not consume external inference quota.
