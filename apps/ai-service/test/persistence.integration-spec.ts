import { Prisma } from "../generated/client";
import { PrismaService } from "../src/prisma.service";
import {
  PrismaAIActionLogRepository,
  PrismaConversationRepository,
  PrismaMessageRepository,
} from "../src/persistence/ai.repositories";
import { Conversation } from "../src/modules/ai/domain/entities/conversation.entity";
import { Message } from "../src/modules/ai/domain/entities/message.entity";
import { AIActionLog } from "../src/modules/ai/domain/entities/ai-action-log.entity";
import { MessageRole } from "../src/modules/ai/domain/enums/ai.enums";

const db = new PrismaService();
const userA = "00000000-0000-4000-8000-0000000000a1";
const userB = "00000000-0000-4000-8000-0000000000b1";
const conversationA = "10000000-0000-4000-8000-0000000000a1";
const conversationB = "10000000-0000-4000-8000-0000000000b1";
const messageEarlier = "20000000-0000-4000-8000-0000000000a1";
const messageLater = "20000000-0000-4000-8000-0000000000a2";
const actionA = "30000000-0000-4000-8000-0000000000a1";

describe("AI PostgreSQL persistence", () => {
  const conversations = new PrismaConversationRepository(db);
  const messages = new PrismaMessageRepository(db);
  const actions = new PrismaAIActionLogRepository(db);

  beforeAll(() => db.$connect());

  beforeEach(async () => {
    await db.aIActionLog.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
    await db.conversation.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
  });

  afterAll(async () => {
    await db.aIActionLog.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
    await db.conversation.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
    await db.$disconnect();
  });

  async function seedConversations(): Promise<void> {
    await conversations.save(
      Conversation.create({ id: conversationA, userId: userA, title: "A" }),
    );
    await conversations.save(
      Conversation.create({ id: conversationB, userId: userB, title: "B" }),
    );
  }

  it("enforces ownership when loading conversations", async () => {
    await seedConversations();

    expect(
      await conversations.findByIdAndUserId(conversationA, userB),
    ).toBeNull();
    expect(
      await conversations.findByIdAndUserId(conversationA, userA),
    ).not.toBeNull();
    expect(
      (await conversations.findPageByUserId(userA, { page: 1, limit: 10 }))
        .total,
    ).toBe(1);
  });

  it("orders messages, persists provider metadata and hides soft-deleted conversations", async () => {
    await seedConversations();
    await messages.save(
      Message.create({
        id: messageLater,
        conversationId: conversationA,
        role: MessageRole.ASSISTANT,
        content: "Later",
        provider: "ollama",
        model: "llama3.2",
        createdAt: new Date("2026-09-24T09:00:00+07:00"),
      }),
    );
    await messages.save(
      Message.create({
        id: messageEarlier,
        conversationId: conversationA,
        role: MessageRole.USER,
        content: "Earlier",
        createdAt: new Date("2026-09-24T01:00:00.000Z"),
      }),
    );

    const page = await messages.findPageByConversationAndUserId(
      conversationA,
      userA,
      { page: 1, limit: 10 },
    );
    expect(page.items.map((message) => message.state.id)).toEqual([
      messageEarlier,
      messageLater,
    ]);
    expect(page.items[1]?.state.provider).toBe("ollama");
    expect(page.items[1]?.state.createdAt.toISOString()).toBe(
      "2026-09-24T02:00:00.000Z",
    );

    const conversation = await conversations.findByIdAndUserId(
      conversationA,
      userA,
    );
    conversation?.delete(new Date("2026-09-24T03:00:00.000Z"));
    if (conversation) await conversations.save(conversation);

    expect(
      await conversations.findByIdAndUserId(conversationA, userA),
    ).toBeNull();
    expect(
      await messages.findPageByConversationAndUserId(conversationA, userA, {
        page: 1,
        limit: 10,
      }),
    ).toMatchObject({ total: 0, items: [] });
  });

  it("enforces the message foreign key", async () => {
    await expect(
      messages.save(
        Message.create({
          id: messageEarlier,
          conversationId: "10000000-0000-4000-8000-000000000099",
          role: MessageRole.USER,
          content: "Orphan",
        }),
      ),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("scopes and orders action-log audit queries by owner", async () => {
    await seedConversations();
    await actions.save(
      AIActionLog.create({
        id: actionA,
        userId: userA,
        conversationId: conversationA,
        toolName: "list_tasks",
        inputPayload: { page: 1 },
        createdAt: new Date("2026-09-24T00:00:00.000Z"),
      }),
    );

    expect(await actions.findByIdAndUserId(actionA, userB)).toBeNull();
    expect(
      await actions.findPageByConversationAndUserId(conversationA, userA, {
        page: 1,
        limit: 10,
      }),
    ).toMatchObject({ total: 1 });

    const action = await actions.findByIdAndUserId(actionA, userA);
    action?.succeed({ taskCount: 2 }, 25);
    if (action) await actions.save(action);
    expect(
      (await actions.findByIdAndUserId(actionA, userA))?.state,
    ).toMatchObject({
      status: "SUCCESS",
      inputPayload: { page: 1 },
      outputPayload: { taskCount: 2 },
      durationMs: 25,
    });
  });

  it("has indexes for the known ordered query patterns", async () => {
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>(Prisma.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'conversations_user_id_updated_at_idx',
          'messages_conversation_id_created_at_idx',
          'ai_action_logs_user_id_created_at_idx',
          'ai_action_logs_conversation_id_created_at_idx'
        )
    `);

    expect(indexes.map(({ indexname }) => indexname).sort()).toEqual([
      "ai_action_logs_conversation_id_created_at_idx",
      "ai_action_logs_user_id_created_at_idx",
      "conversations_user_id_updated_at_idx",
      "messages_conversation_id_created_at_idx",
    ]);
  });
});
