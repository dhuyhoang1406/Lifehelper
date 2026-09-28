import type {
  AIPageQuery,
  ConversationRepository,
  MessageRepository,
} from "../repositories/ai.repositories";
import { AIApplicationError, AIErrorCode } from "../errors/ai.errors";
import { Conversation } from "../../modules/ai/domain/entities/conversation.entity";
import { Message } from "../../modules/ai/domain/entities/message.entity";
import { MessageRole } from "../../modules/ai/domain/enums/ai.enums";
import { AIConversationUseCases } from "./ai-conversation.use-cases";
import { AIProviderRetryPolicy } from "./ai-provider-retry.policy";
import { AIProviderRegistry, AIProviderRouter } from "./ai-provider.router";
import { FakeAIProvider } from "../../testing/fake-ai.provider";

const userA = "00000000-0000-4000-8000-0000000000a1";
const userB = "00000000-0000-4000-8000-0000000000b1";
const success = {
  content: "Done",
  toolCalls: [],
  finishReason: "stop" as const,
  usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  metadata: { provider: "ollama" as const, model: "test-model", latencyMs: 7 },
};

class TestConversations implements ConversationRepository {
  readonly rows = new Map<string, Conversation>();

  async findByIdAndUserId(id: string, userId: string) {
    const row = this.rows.get(id);
    return row?.state.userId === userId && !row.state.deletedAt ? row : null;
  }

  async nextMessageAt(id: string, userId: string): Promise<Date | null> {
    const row = await this.findByIdAndUserId(id, userId);
    if (!row) return null;
    const at = new Date(Math.max(Date.now(), row.state.updatedAt.getTime() + 1));
    row.rename(row.state.title, at);
    return at;
  }

  async findPageByUserId(userId: string, query: AIPageQuery) {
    const rows = [...this.rows.values()].filter(
      (row) => row.state.userId === userId && !row.state.deletedAt,
    );
    return {
      items: rows.slice((query.page - 1) * query.limit, query.page * query.limit),
      total: rows.length,
      ...query,
    };
  }

  async save(entity: Conversation) {
    this.rows.set(entity.state.id, entity);
  }
}

class TestMessages implements MessageRepository {
  readonly rows: Message[] = [];
  constructor(private readonly conversations: TestConversations) {}

  async saveMany(entities: readonly Message[]) {
    this.rows.push(...entities);
  }

  async findRecentByConversationAndUserId(
    conversationId: string,
    userId: string,
    limit: number,
    through?: Date,
  ) {
    if (!(await this.conversations.findByIdAndUserId(conversationId, userId)))
      return [];
    return this.rows
      .filter(
        (row) =>
          row.state.conversationId === conversationId &&
          (!through || row.state.createdAt <= through),
      )
      .slice(-limit);
  }

  async findBeforeByConversationAndUserId(
    conversationId: string,
    userId: string,
    before: { createdAt: Date; id: string } | null,
    limit: number,
  ) {
    const rows = (await this.conversations.findByIdAndUserId(conversationId, userId))
      ? this.rows.filter((row) => row.state.conversationId === conversationId)
      : [];
    return rows
      .filter(
        (row) =>
          !before ||
          row.state.createdAt < before.createdAt ||
          (row.state.createdAt.getTime() === before.createdAt.getTime() &&
            row.state.id < before.id),
      )
      .sort(
        (a, b) =>
          b.state.createdAt.getTime() - a.state.createdAt.getTime() ||
          b.state.id.localeCompare(a.state.id),
      )
      .slice(0, limit);
  }

  async save(entity: Message) {
    this.rows.push(entity);
  }
}

describe("AIConversationUseCases", () => {
  let conversations: TestConversations;
  let messages: TestMessages;
  let generate: jest.Mock;
  let useCases: AIConversationUseCases;

  beforeEach(() => {
    conversations = new TestConversations();
    messages = new TestMessages(conversations);
    generate = jest.fn().mockResolvedValue(success);
    useCases = new AIConversationUseCases(conversations, messages, { generate }, 2);
  });

  it("creates and continues a conversation with bounded chronological context", async () => {
    const first = await useCases.chat(userA, "First");
    const second = await useCases.chat(userA, "Second", first.conversationId);
    await useCases.chat(userA, "Third", first.conversationId);

    expect(second.conversationId).toBe(first.conversationId);
    expect(messages.rows.map((row) => row.state.role)).toEqual([
      MessageRole.USER,
      MessageRole.ASSISTANT,
      MessageRole.USER,
      MessageRole.ASSISTANT,
      MessageRole.USER,
      MessageRole.ASSISTANT,
    ]);
    expect(generate.mock.calls[2]?.[0].messages).toEqual([
      { role: MessageRole.ASSISTANT, content: "Done" },
      { role: MessageRole.USER, content: "Third" },
    ]);
    expect(messages.rows[1]?.state).toMatchObject({
      provider: "ollama",
      model: "test-model",
      inputTokens: 3,
      outputTokens: 2,
    });
  });

  it("preserves the user message and no assistant message when provider fails", async () => {
    generate.mockRejectedValueOnce(
      new AIApplicationError(AIErrorCode.AI_PROVIDER_UNAVAILABLE, "Offline", 503),
    );
    await expect(useCases.chat(userA, "Keep this")).rejects.toMatchObject({
      code: AIErrorCode.AI_PROVIDER_UNAVAILABLE,
    });
    expect(messages.rows.map((row) => row.state.content)).toEqual(["Keep this"]);
    expect(conversations.rows.size).toBe(1);
  });

  it("does not save an empty or tool-only provider response as a successful chat", async () => {
    generate.mockResolvedValueOnce({ ...success, content: null, toolCalls: [] });
    await expect(useCases.chat(userA, "Question")).rejects.toMatchObject({
      code: AIErrorCode.AI_PROVIDER_INVALID_RESPONSE,
    });
    expect(messages.rows).toHaveLength(1);
  });

  it("hides another user's conversation and soft-deleted history", async () => {
    const chat = await useCases.chat(userA, "Private");
    const query = { page: 1, limit: 20 };
    await expect(useCases.get(userB, chat.conversationId, query)).rejects.toMatchObject({
      code: AIErrorCode.AI_CONVERSATION_NOT_FOUND,
      statusCode: 404,
    });
    await expect(useCases.delete(userB, chat.conversationId)).rejects.toMatchObject({
      code: AIErrorCode.AI_CONVERSATION_NOT_FOUND,
    });
    expect((await useCases.list(userA, query)).total).toBe(1);
    expect((await useCases.list(userB, query)).total).toBe(0);
    await useCases.delete(userA, chat.conversationId);
    expect((await useCases.list(userA, query)).total).toBe(0);
    await expect(useCases.get(userA, chat.conversationId, query)).rejects.toMatchObject({
      code: AIErrorCode.AI_CONVERSATION_NOT_FOUND,
    });
  });

  it("loads recent messages, then older messages, without shifts when new messages arrive", async () => {
    const chat = await useCases.chat(userA, "First");
    await useCases.chat(userA, "Second", chat.conversationId);
    const latest = await useCases.get(userA, chat.conversationId, { limit: 2 });
    expect(latest.messages.items.map((item) => item.content)).toEqual([
      "Second",
      "Done",
    ]);
    expect(latest.messages.hasMore).toBe(true);
    expect(latest.messages.nextCursor).toEqual(expect.any(String));
    await useCases.chat(userA, "Third", chat.conversationId);
    const older = await useCases.get(userA, chat.conversationId, {
      limit: 2,
      cursor: latest.messages.nextCursor!,
    });
    expect(older.messages.items.map((item) => item.content)).toEqual([
      "First",
      "Done",
    ]);
    expect(older.messages).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("rejects malformed and cross-conversation cursors", async () => {
    const first = await useCases.chat(userA, "First");
    const second = await useCases.chat(userA, "Second");
    const cursor = (await useCases.get(userA, first.conversationId, { limit: 1 }))
      .messages.nextCursor!;
    await expect(
      useCases.get(userA, first.conversationId, { limit: 2, cursor: "bad" }),
    ).rejects.toMatchObject({ code: AIErrorCode.AI_INVALID_CURSOR });
    await expect(
      useCases.get(userA, second.conversationId, { limit: 2, cursor }),
    ).rejects.toMatchObject({ code: AIErrorCode.AI_INVALID_CURSOR });
  });

  it("persists both concurrent user and assistant messages", async () => {
    const chat = await useCases.chat(userA, "Initial");
    await Promise.all([
      useCases.chat(userA, "Parallel A", chat.conversationId),
      useCases.chat(userA, "Parallel B", chat.conversationId),
    ]);
    expect(messages.rows.filter((row) => row.state.conversationId === chat.conversationId))
      .toHaveLength(6);
    expect(messages.rows.filter((row) => row.state.role === MessageRole.USER))
      .toHaveLength(3);
  });

  it.each(["ollama", "cloudflare"] as const)(
    "uses the same chat workflow with %s selected",
    async (name) => {
      const fake = new FakeAIProvider(name);
      fake.enqueueResponse({
        ...success,
        metadata: { ...success.metadata, provider: name },
      });
      const router = new AIProviderRouter(
        name,
        new AIProviderRegistry([fake]),
        new AIProviderRetryPolicy(
          { maxAttempts: 1, baseDelayMs: 1 },
          { wait: async () => undefined },
          { next: () => 0 },
        ),
      );
      const routed = new AIConversationUseCases(
        conversations,
        messages,
        router,
        2,
      );

      const result = await routed.chat(userA, "Hi");
      expect(result.metadata.provider).toBe(name);
      expect(fake.requests[0]?.messages).toEqual([
        { role: MessageRole.USER, content: "Hi" },
      ]);
    },
  );
});
