import type {
  AIActionLog as AIActionLogRecord,
  Conversation as ConversationRecord,
  Message as MessageRecord,
} from "../../generated/client";
import {
  AIActionStatus as PrismaAIActionStatus,
  MessageRole as PrismaMessageRole,
  Prisma,
} from "../../generated/client";
import {
  AIActionLogMapper,
  ConversationMapper,
  MessageMapper,
} from "./ai.mappers";

describe("AI persistence mappers", () => {
  const createdAt = new Date("2026-09-24T02:30:00.000Z");

  it("round-trips a conversation through restore semantics", () => {
    const record: ConversationRecord = {
      id: "10000000-0000-4000-8000-000000000001",
      userId: "20000000-0000-4000-8000-000000000001",
      title: "Planning",
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    };

    expect(
      ConversationMapper.toPersistence(ConversationMapper.toDomain(record)),
    ).toEqual(record);
  });

  it("round-trips provider and model metadata on a message", () => {
    const record: MessageRecord = {
      id: "30000000-0000-4000-8000-000000000001",
      conversationId: "10000000-0000-4000-8000-000000000001",
      role: PrismaMessageRole.ASSISTANT,
      content: "Done",
      provider: "ollama",
      model: "llama3.2",
      inputTokens: 12,
      outputTokens: 4,
      createdAt,
    };

    expect(MessageMapper.toPersistence(MessageMapper.toDomain(record))).toEqual(
      record,
    );
  });

  it("restores an action log without leaking Prisma enum types", () => {
    const record: AIActionLogRecord = {
      id: "40000000-0000-4000-8000-000000000001",
      userId: "20000000-0000-4000-8000-000000000001",
      conversationId: null,
      messageId: null,
      toolName: "list_tasks",
      inputPayload: { page: 1 },
      outputPayload: null,
      status: PrismaAIActionStatus.REQUESTED,
      errorCode: null,
      durationMs: null,
      createdAt,
    };

    const domain = AIActionLogMapper.toDomain(record);

    expect(domain.state.status).toBe("REQUESTED");
    expect(domain.state.inputPayload).toEqual({ page: 1 });
    expect(AIActionLogMapper.toPersistence(domain)).toEqual({
      ...record,
      outputPayload: Prisma.DbNull,
    });
  });
});
