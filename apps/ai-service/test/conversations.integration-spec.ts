import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import {
  AIApplicationError,
  AIErrorCode,
  AIProviderFailure,
} from "../src/application/errors/ai.errors";
import { AI_PROVIDER_INSTANCE } from "../src/application/ports/ai-provider.port";
import {
  PRODUCTIVITY_READ_CLIENT,
  type ProductivityReadClient,
} from "../src/application/ports/productivity-read.port";
import { PrismaService } from "../src/prisma.service";
import { FakeAIProvider } from "../src/testing/fake-ai.provider";

const userA = "00000000-0000-4000-8000-00000000ca01";
const userB = "00000000-0000-4000-8000-00000000cb01";
const reply = {
  content: "Stored answer",
  toolCalls: [],
  finishReason: "stop" as const,
  usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
  metadata: { provider: "ollama" as const, model: "test-model", latencyMs: 5 },
};

describe("AI conversations with PostgreSQL (HTTP integration)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let tokenA: string;
  let tokenB: string;
  const provider = new FakeAIProvider("ollama");
  const productivity: jest.Mocked<ProductivityReadClient> = {
    listTasks: jest.fn(),
    listCalendar: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_INSTANCE)
      .useValue(provider)
      .overrideProvider(PRODUCTIVITY_READ_CLIENT)
      .useValue(productivity)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(PrismaService);
    const jwt = app.get(JwtService);
    const options = {
      secret: process.env.JWT_ACCESS_SECRET,
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    };
    tokenA = await jwt.signAsync(
      { sub: userA, sessionId: "session-a", tokenType: "access" },
      options,
    );
    tokenB = await jwt.signAsync(
      { sub: userB, sessionId: "session-b", tokenType: "access" },
      options,
    );
  });

  async function clearSyntheticRecords() {
    const conversations = await db.conversation.findMany({
      where: { userId: { in: [userA, userB] } },
      select: { id: true },
    });
    await db.outboxEvent.deleteMany({
      where: { aggregateId: { in: conversations.map(({ id }) => id) } },
    });
    await db.conversation.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
  }

  beforeEach(async () => {
    await clearSyntheticRecords();
    provider.requests.length = 0;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await clearSyntheticRecords();
    await app?.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("executes only authorized read tools and persists a reconstructable tool exchange", async () => {
    productivity.listTasks.mockResolvedValue({
      items: [
        {
          id: "task-1",
          title: "Read",
          status: "TODO",
          priority: "LOW",
          dueAt: null,
        },
      ],
      total: 1,
    });
    provider.enqueueResponse({
      ...reply,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [
        { id: "call-1", name: "get_tasks", arguments: { status: "TODO" } },
      ],
    });
    provider.enqueueResponse(reply);
    const created = await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .set("x-correlation-id", "trace-a")
      .send({ prompt: "Show my tasks" })
      .expect(200);
    const conversationId = created.body.conversationId as string;
    const completedEvent = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateId: conversationId, eventType: "ai.completed" },
    });
    expect(completedEvent.payload).toMatchObject({
      payload: {
        provider: "ollama",
        model: "test-model",
        inputTokens: 8,
        outputTokens: 6,
        durationMs: expect.any(Number),
      },
    });
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      "get_tasks",
      "get_today_tasks",
      "get_schedule",
      "create_task",
      "update_task",
      "complete_task",
      "create_calendar_event",
      "create_reminder",
      "create_habit",
      "log_habit",
    ]);
    expect(productivity.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: userA,
        accessToken: tokenA,
        correlationId: "trace-a",
      }),
      expect.objectContaining({ status: "TODO", limit: 20 }),
    );
    expect(
      provider.requests[1]?.messages.map((message) => message.role),
    ).toEqual(["SYSTEM", "USER", "ASSISTANT", "TOOL"]);
    expect(await db.message.count({ where: { conversationId } })).toBe(4);
    const storedCalls = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    expect(storedCalls[1]?.toolPayload).toMatchObject({ kind: "tool_calls" });
    expect(storedCalls[1]?.content).toBe("");
    expect(storedCalls[2]?.toolPayload).toMatchObject({
      kind: "tool_result",
      id: "call-1",
    });
    provider.enqueueResponse(reply);
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Continue", conversationId })
      .expect(200);
    expect(provider.requests[2]?.messages[2]).toMatchObject({
      role: "ASSISTANT",
      toolCalls: [{ id: "call-1", name: "get_tasks" }],
    });
    expect(provider.requests[2]?.messages[3]).toMatchObject({
      role: "TOOL",
      toolCallId: "call-1",
    });
    await request(app.getHttpServer())
      .get(`/ai/conversations/${conversationId}`)
      .set(auth(tokenB))
      .expect(404);
  });

  it("rejects an unregistered tool before any Productivity request", async () => {
    provider.enqueueResponse({
      ...reply,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [
        { id: "call-1", name: "delete_task", arguments: { userId: userB } },
      ],
    });
    const response = await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Bad tool" })
      .expect(400);
    expect(response.body.code).toBe(AIErrorCode.AI_TOOL_CALL_INVALID);
    const conversation = await db.conversation.findFirstOrThrow({ where: { userId: userA } });
    const failed = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateId: conversation.id, eventType: "ai.failed" },
    });
    expect(failed.payload).toMatchObject({
      payload: { errorCode: AIErrorCode.AI_TOOL_CALL_INVALID },
    });
    expect(JSON.stringify(failed.payload)).not.toContain("Bad tool");
    expect(productivity.listTasks).not.toHaveBeenCalled();
    expect(productivity.listCalendar).not.toHaveBeenCalled();
  });

  it("validates the whole tool batch before making any downstream call", async () => {
    provider.enqueueResponse({
      ...reply,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [
        { id: "valid", name: "get_tasks", arguments: {} },
        { id: "invalid", name: "get_tasks", arguments: { userId: userB } },
      ],
    });
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Invalid batch" })
      .expect(400);
    expect(productivity.listTasks).not.toHaveBeenCalled();
  });

  it("sends only a stable error code to the model when Productivity fails", async () => {
    productivity.listTasks.mockRejectedValue(
      new AIApplicationError(
        AIErrorCode.AI_PRODUCTIVITY_UNAVAILABLE,
        "private upstream details",
        502,
      ),
    );
    provider.enqueueResponse({
      ...reply,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [{ id: "call-1", name: "get_tasks", arguments: {} }],
    });
    provider.enqueueResponse(reply);
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Try tasks" })
      .expect(200);
    const toolContent = provider.requests[1]?.messages.find(
      (message) => message.role === "TOOL",
    )?.content;
    expect(toolContent).toBe('{"error":"AI_PRODUCTIVITY_UNAVAILABLE"}');
    expect(toolContent).not.toContain("private upstream details");
  });

  it("passes validated client timezone to the provider without hardcoding a default", async () => {
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Today", timezone: "invalid/timezone" })
      .expect(400);
    provider.enqueueResponse(reply);
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Today", timezone: "Asia/Ho_Chi_Minh" })
      .expect(200);
    expect(provider.requests[0]?.messages[0]).toMatchObject({
      role: "SYSTEM",
      content: expect.stringContaining("User timezone: Asia/Ho_Chi_Minh"),
    });
  });

  it("persists chat, orders and paginates messages, and hides other users' data", async () => {
    await request(app.getHttpServer())
      .post("/ai/chat")
      .send({ prompt: "No token" })
      .expect(401);
    provider.enqueueResponse(reply);
    const first = await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "First question" })
      .expect(200);
    const id = first.body.conversationId as string;
    expect(first.body).toMatchObject({
      content: "Stored answer",
      usage: reply.usage,
    });
    expect(await db.message.count({ where: { conversationId: id } })).toBe(2);

    provider.enqueueResponse(reply);
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Second question", conversationId: id })
      .expect(200);
    expect(
      provider.requests[1]?.messages.map((message) => message.content).slice(1),
    ).toEqual(["First question", "Stored answer", "Second question"]);

    const history = await request(app.getHttpServer())
      .get(`/ai/conversations/${id}?limit=2`)
      .set(auth(tokenA))
      .expect(200);
    expect(history.body.messages).toMatchObject({ limit: 2, hasMore: true });
    expect(
      history.body.messages.items.map(
        (message: { content: string }) => message.content,
      ),
    ).toEqual(["Second question", "Stored answer"]);
    const older = await request(app.getHttpServer())
      .get(
        `/ai/conversations/${id}?limit=2&cursor=${history.body.messages.nextCursor}`,
      )
      .set(auth(tokenA))
      .expect(200);
    expect(older.body.messages).toMatchObject({
      hasMore: false,
      nextCursor: null,
    });
    expect(
      older.body.messages.items.map(
        (message: { content: string }) => message.content,
      ),
    ).toEqual(["First question", "Stored answer"]);
    await request(app.getHttpServer())
      .get(`/ai/conversations/${id}?limit=2&cursor=bad`)
      .set(auth(tokenA))
      .expect(400)
      .expect(({ body }) =>
        expect(body.code).toBe(AIErrorCode.AI_INVALID_CURSOR),
      );
    await request(app.getHttpServer())
      .get(`/ai/conversations/${id}`)
      .set(auth(tokenB))
      .expect(404)
      .expect(({ body }) =>
        expect(body.code).toBe(AIErrorCode.AI_CONVERSATION_NOT_FOUND),
      );
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenB))
      .send({ prompt: "Intrude", conversationId: id })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/ai/conversations/${id}`)
      .set(auth(tokenB))
      .expect(404);
    const listB = await request(app.getHttpServer())
      .get("/ai/conversations")
      .set(auth(tokenB))
      .expect(200);
    expect(listB.body.total).toBe(0);
    const listA = await request(app.getHttpServer())
      .get("/ai/conversations?page=1&limit=1")
      .set(auth(tokenA))
      .expect(200);
    expect(listA.body).toMatchObject({ page: 1, limit: 1, total: 1 });
    expect(listA.body.items[0].id).toBe(id);

    await request(app.getHttpServer())
      .delete(`/ai/conversations/${id}`)
      .set(auth(tokenA))
      .expect(204);
    expect(await db.message.count({ where: { conversationId: id } })).toBe(4);
    await request(app.getHttpServer())
      .get(`/ai/conversations/${id}`)
      .set(auth(tokenA))
      .expect(404);
    await request(app.getHttpServer())
      .get("/ai/conversations")
      .set(auth(tokenA))
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(0));
  });

  it("keeps the user message but no assistant success when provider fails", async () => {
    provider.enqueueError(
      new AIProviderFailure("unavailable", "offline", false),
    );
    const result = await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .set("x-correlation-id", "test-correlation")
      .send({ prompt: "Keep this message" })
      .expect(503);
    expect(result.body).toMatchObject({
      code: AIErrorCode.AI_PROVIDER_UNAVAILABLE,
      correlationId: "test-correlation",
    });
    const rows = await db.message.findMany({
      where: { conversation: { userId: userA } },
    });
    expect(rows.map((row) => row.role)).toEqual(["USER"]);
    expect(rows[0]?.content).toBe("Keep this message");
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: rows[0]!.conversationId },
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "ai.failed",
      "ai.requested",
    ]);
    expect(
      events.every(
        (event) =>
          (event.payload as { correlationId: string }).correlationId ===
          "test-correlation",
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("Keep this message");
  });

  it("rejects invalid input and retains all concurrent messages", async () => {
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "", userId: userB })
      .expect(400);
    await request(app.getHttpServer())
      .get("/ai/conversations?page=0&limit=1000")
      .set(auth(tokenA))
      .expect(400);
    provider.enqueueResponse(reply);
    const first = await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Initial" })
      .expect(200);
    const id = first.body.conversationId as string;
    provider.enqueueResponse(reply);
    provider.enqueueResponse(reply);
    await Promise.all([
      request(app.getHttpServer())
        .post("/ai/chat")
        .set(auth(tokenA))
        .send({ prompt: "Parallel A", conversationId: id })
        .expect(200),
      request(app.getHttpServer())
        .post("/ai/chat")
        .set(auth(tokenA))
        .send({ prompt: "Parallel B", conversationId: id })
        .expect(200),
    ]);
    expect(await db.message.count({ where: { conversationId: id } })).toBe(6);
  });
});
