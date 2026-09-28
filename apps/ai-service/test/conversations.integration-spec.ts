import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AIErrorCode, AIProviderFailure } from "../src/application/errors/ai.errors";
import { AI_PROVIDER_INSTANCE } from "../src/application/ports/ai-provider.port";
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

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_INSTANCE)
      .useValue(provider)
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

  beforeEach(async () => {
    await db.conversation.deleteMany({ where: { userId: { in: [userA, userB] } } });
    provider.requests.length = 0;
  });

  afterAll(async () => {
    await db?.conversation.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await app?.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("persists chat, orders and paginates messages, and hides other users' data", async () => {
    await request(app.getHttpServer()).post("/ai/chat").send({ prompt: "No token" }).expect(401);
    provider.enqueueResponse(reply);
    const first = await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "First question" })
      .expect(200);
    const id = first.body.conversationId as string;
    expect(first.body).toMatchObject({ content: "Stored answer", usage: reply.usage });
    expect(await db.message.count({ where: { conversationId: id } })).toBe(2);

    provider.enqueueResponse(reply);
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Second question", conversationId: id })
      .expect(200);
    expect(provider.requests[1]?.messages.map((message) => message.content)).toEqual([
      "First question",
      "Stored answer",
      "Second question",
    ]);

    const history = await request(app.getHttpServer())
      .get(`/ai/conversations/${id}?limit=2`)
      .set(auth(tokenA))
      .expect(200);
    expect(history.body.messages).toMatchObject({ limit: 2, hasMore: true });
    expect(history.body.messages.items.map((message: { content: string }) => message.content))
      .toEqual(["Second question", "Stored answer"]);
    const older = await request(app.getHttpServer())
      .get(`/ai/conversations/${id}?limit=2&cursor=${history.body.messages.nextCursor}`)
      .set(auth(tokenA))
      .expect(200);
    expect(older.body.messages).toMatchObject({ hasMore: false, nextCursor: null });
    expect(older.body.messages.items.map((message: { content: string }) => message.content))
      .toEqual(["First question", "Stored answer"]);
    await request(app.getHttpServer())
      .get(`/ai/conversations/${id}?limit=2&cursor=bad`)
      .set(auth(tokenA))
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe(AIErrorCode.AI_INVALID_CURSOR));
    await request(app.getHttpServer())
      .get(`/ai/conversations/${id}`)
      .set(auth(tokenB))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe(AIErrorCode.AI_CONVERSATION_NOT_FOUND));
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
    provider.enqueueError(new AIProviderFailure("unavailable", "offline", false));
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
