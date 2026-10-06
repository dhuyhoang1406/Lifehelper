import { randomUUID } from "node:crypto";
import { EVENT_VERSION, type EventEnvelope } from "@lifehelper/event-contracts";
import type { OutboxEventInput } from "@lifehelper/shared-types";
import type { AIProviderMetadata, AIUsage } from "../ports/ai-provider.port";
import type { ValidatedWriteCall } from "./ai-write-tools";

export type AIEventType =
  "ai.requested" | "ai.completed" | "ai.failed" | "ai.tool.executed";
export type AIAuditPayload = Record<string, string | number | null>;

const toolAuditKeys: Record<ValidatedWriteCall["name"], readonly string[]> = {
  create_task: ["priority"],
  update_task: ["taskId", "priority", "status"],
  complete_task: ["taskId"],
  create_calendar_event: ["eventType", "timezone"],
  create_reminder: ["resourceType", "timezone"],
  create_habit: ["frequencyType", "timezone"],
  log_habit: ["habitId", "timezone"],
};

export function actionAuditFields(call: ValidatedWriteCall): AIAuditPayload {
  const fields: AIAuditPayload = {};
  for (const key of toolAuditKeys[call.name]) {
    const value = call.arguments[key];
    if (typeof value === "string" || typeof value === "number")
      fields[key] = value;
  }
  return fields;
}

export function usageAuditFields(
  usage: AIUsage,
  metadata: AIProviderMetadata,
): AIAuditPayload {
  return {
    provider: metadata.provider,
    model: metadata.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: metadata.totalLatencyMs ?? metadata.latencyMs,
  };
}

export function aiOutboxEvent(input: {
  type: AIEventType;
  aggregateType: "conversation" | "action";
  aggregateId: string;
  correlationId: string;
  payload: AIAuditPayload;
  occurredAt: Date;
  id?: string;
}): OutboxEventInput {
  const id = input.id ?? randomUUID();
  const envelope: EventEnvelope<AIAuditPayload> = {
    id,
    type: input.type,
    version: EVENT_VERSION,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    producer: "ai-service",
    payload: input.payload,
  };
  return {
    id,
    eventType: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: { ...envelope },
    occurredAt: input.occurredAt,
  };
}
