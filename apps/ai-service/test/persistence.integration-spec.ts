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

  async function clearSyntheticRecords() {
    const [actionRows, conversationRows] = await Promise.all([
      db.aIActionLog.findMany({
        where: { userId: { in: [userA, userB] } },
        select: { id: true },
      }),
      db.conversation.findMany({
        where: { userId: { in: [userA, userB] } },
        select: { id: true },
      }),
    ]);
    await db.outboxEvent.deleteMany({
      where: {
        aggregateId: {
          in: [...actionRows, ...conversationRows].map(({ id }) => id),
        },
      },
    });
    await db.aIActionLog.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
    await db.conversation.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
  }

  beforeEach(async () => {
    await clearSyntheticRecords();
  });

  afterAll(async () => {
    await clearSyntheticRecords();
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

  it("commits an action with its event and rolls both back when the event insert fails", async () => {
    await seedConversations();
    const eventId = "50000000-0000-4000-8000-0000000000a1";
    const event = {
      id: eventId,
      eventType: "ai.requested",
      aggregateType: "action",
      aggregateId: actionA,
      occurredAt: new Date("2026-09-30T00:00:00Z"),
      payload: { version: 1, correlationId: "trace-a" },
    };
    const action = AIActionLog.create({
      id: actionA,
      userId: userA,
      conversationId: conversationA,
      toolName: "create_task",
      inputPayload: { title: "Private title" },
    });
    await actions.saveWithEvent(action, event);
    expect(
      await db.aIActionLog.findUnique({ where: { id: actionA } }),
    ).not.toBeNull();
    expect(
      await db.outboxEvent.findUnique({ where: { id: eventId } }),
    ).not.toBeNull();

    const failedId = "30000000-0000-4000-8000-0000000000a2";
    const failed = AIActionLog.create({
      id: failedId,
      userId: userA,
      conversationId: conversationA,
      toolName: "create_task",
      inputPayload: { title: "Another private title" },
    });
    await expect(
      actions.saveWithEvent(failed, { ...event, aggregateId: failedId }),
    ).rejects.toThrow();
    expect(
      await db.aIActionLog.findUnique({ where: { id: failedId } }),
    ).toBeNull();
    await db.outboxEvent.delete({ where: { id: eventId } });
  });

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

    const latest = await messages.findBeforeByConversationAndUserId(
      conversationA,
      userA,
      null,
      1,
    );
    expect(latest.map((message) => message.state.id)).toEqual([messageLater]);
    expect(latest[0]?.state.provider).toBe("ollama");
    expect(latest[0]?.state.createdAt.toISOString()).toBe(
      "2026-09-24T02:00:00.000Z",
    );
    expect(
      (
        await messages.findBeforeByConversationAndUserId(
          conversationA,
          userA,
          { createdAt: latest[0]!.state.createdAt, id: latest[0]!.state.id },
          1,
        )
      ).map((message) => message.state.id),
    ).toEqual([messageEarlier]);
    expect(
      await messages.findBeforeByConversationAndUserId(
        conversationA,
        userB,
        null,
        10,
      ),
    ).toEqual([]);
    expect(
      (
        await messages.findRecentByConversationAndUserId(
          conversationA,
          userA,
          1,
        )
      ).map((message) => message.state.id),
    ).toEqual([messageLater]);

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
      await messages.findBeforeByConversationAndUserId(
        conversationA,
        userA,
        null,
        10,
      ),
    ).toEqual([]);
  });

  it("allocates owner-scoped, strictly increasing message timestamps", async () => {
    await seedConversations();
    expect(await conversations.nextMessageAt(conversationA, userB)).toBeNull();
    const first = await conversations.nextMessageAt(conversationA, userA);
    const second = await conversations.nextMessageAt(conversationA, userA);
    expect(first).toBeInstanceOf(Date);
    expect(second!.getTime()).toBeGreaterThan(first!.getTime());
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
    action?.start();
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

  it("emits correlated failure events for expired and interrupted actions", async () => {
    await seedConversations();
    const now = new Date("2026-09-30T12:00:00.000Z");
    const interruptedId = "30000000-0000-4000-8000-0000000000a2";
    for (const id of [actionA, interruptedId]) {
      await actions.save(
        AIActionLog.create({
          id,
          userId: userA,
          conversationId: conversationA,
          toolName: "create_task",
          inputPayload: { title: "Private" },
          correlationId: "trace-recovery",
          expiresAt: new Date("2026-09-30T09:00:00Z"),
        }),
      );
    }
    await db.aIActionLog.update({
      where: { id: interruptedId },
      data: { status: "EXECUTING" },
    });
    await actions.recoverStale(now, new Date("2026-09-30T11:00:00Z"));
    expect(
      await db.aIActionLog.findUniqueOrThrow({ where: { id: actionA } }),
    ).toMatchObject({ status: "REJECTED", errorCode: "ACTION_EXPIRED" });
    expect(
      await db.aIActionLog.findUniqueOrThrow({ where: { id: interruptedId } }),
    ).toMatchObject({
      status: "FAILED",
      errorCode: "AI_ACTION_OUTCOME_UNKNOWN",
    });
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: { in: [actionA, interruptedId] } },
    });
    expect(events).toHaveLength(2);
    expect(
      events.every(
        (event) =>
          event.eventType === "ai.failed" &&
          (event.payload as { correlationId: string }).correlationId ===
            "trace-recovery",
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("Private");
  });

  it("has indexes for the known ordered query patterns", async () => {
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>(Prisma.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'conversations_user_id_updated_at_idx',
          'messages_conversation_id_created_at_id_idx',
          'ai_action_logs_user_id_created_at_idx',
          'ai_action_logs_conversation_id_created_at_idx'
        )
    `);

    expect(indexes.map(({ indexname }) => indexname).sort()).toEqual([
      "ai_action_logs_conversation_id_created_at_idx",
      "ai_action_logs_user_id_created_at_idx",
      "conversations_user_id_updated_at_idx",
      "messages_conversation_id_created_at_id_idx",
    ]);
  });
});
