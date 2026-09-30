import { EVENT_VERSION } from "@lifehelper/event-contracts";
import {
  actionAuditFields,
  aiOutboxEvent,
  usageAuditFields,
} from "./ai-audit-events";
import { validateWriteCall } from "./ai-write-tools";

it("uses the shared versioned envelope, UTC timestamp and correlation ID", () => {
  const occurredAt = new Date("2026-09-30T09:30:00+07:00");
  const event = aiOutboxEvent({
    id: "00000000-0000-4000-8000-000000000001",
    type: "ai.completed",
    aggregateType: "conversation",
    aggregateId: "00000000-0000-4000-8000-000000000002",
    correlationId: "trace-123",
    occurredAt,
    payload: { inputTokens: 4, outputTokens: 2 },
  });
  expect(event.eventType).toBe("ai.completed");
  expect(event.payload).toEqual({
    id: event.id,
    type: "ai.completed",
    version: EVENT_VERSION,
    occurredAt: "2026-09-30T02:30:00.000Z",
    correlationId: "trace-123",
    producer: "ai-service",
    payload: { inputTokens: 4, outputTokens: 2 },
  });
});

it("allowlists audit fields and omits free text, secrets and full tool inputs", () => {
  const call = validateWriteCall({
    id: "call-1",
    name: "create_calendar_event",
    arguments: {
      title: "Private meeting with patient",
      description: "Sensitive notes",
      eventType: "MEETING",
      timezone: "UTC",
      startAt: "2026-10-12T10:00:00Z",
      endAt: "2026-10-12T11:00:00Z",
    },
  });
  expect(call).not.toBeNull();
  expect(actionAuditFields(call!)).toEqual({
    eventType: "MEETING",
    timezone: "UTC",
  });
  expect(JSON.stringify(actionAuditFields(call!))).not.toContain(
    "Private meeting",
  );
  expect(
    usageAuditFields(
      { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      {
        provider: "ollama",
        model: "test-model",
        latencyMs: 12,
        rawUsage: { secret: "not-for-audit" },
      },
    ),
  ).toEqual({
    provider: "ollama",
    model: "test-model",
    inputTokens: 3,
    outputTokens: 2,
    durationMs: 12,
  });
});
