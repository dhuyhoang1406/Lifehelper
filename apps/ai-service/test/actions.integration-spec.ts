import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AI_PROVIDER_INSTANCE } from "../src/modules/ai/application/ports/ai-provider.port";
import type { AIJsonObject } from "../src/modules/ai/application/ports/ai-provider.port";
import {
  PRODUCTIVITY_WRITE_CLIENT,
  type ProductivityWriteClient,
} from "../src/modules/ai/application/ports/productivity-write.port";
import {
  AIApplicationError,
  AIErrorCode,
} from "../src/modules/ai/application/errors/ai.errors";
import { FakeAIProvider } from "../src/testing/fake-ai.provider";
import { PrismaService } from "../src/prisma.service";
import {
  AI_ACTION_LOG_REPOSITORY,
  type AIActionLogRepository,
} from "../src/modules/ai/application/repositories/ai.repositories";

const userA = "00000000-0000-4000-8000-00000000da01";
const userB = "00000000-0000-4000-8000-00000000db01";
const taskId = "00000000-0000-4000-8000-000000000001";
const writes: Array<{ name: string; args: AIJsonObject; timezone?: string }> = [
  { name: "create_task", args: { title: "Read" } },
  { name: "update_task", args: { taskId, title: "Updated" } },
  { name: "complete_task", args: { taskId } },
  {
    name: "create_calendar_event",
    args: {
      title: "Meeting",
      eventType: "MEETING",
      startAt: "2026-10-12T18:00:00+07:00",
      endAt: "2026-10-12T19:00:00+07:00",
      timezone: "Asia/Ho_Chi_Minh",
    },
    timezone: "Asia/Ho_Chi_Minh",
  },
  {
    name: "create_reminder",
    args: {
      resourceType: "CUSTOM",
      title: "Call",
      remindAt: "2026-10-12T18:00:00+07:00",
      timezone: "Asia/Ho_Chi_Minh",
    },
    timezone: "Asia/Ho_Chi_Minh",
  },
  {
    name: "create_habit",
    args: {
      name: "Walk",
      frequencyType: "DAILY",
      timezone: "Asia/Ho_Chi_Minh",
      startDate: "2026-10-12",
    },
    timezone: "Asia/Ho_Chi_Minh",
  },
  {
    name: "log_habit",
    args: {
      habitId: taskId,
      logDate: "2026-10-12",
      timezone: "Asia/Ho_Chi_Minh",
    },
    timezone: "Asia/Ho_Chi_Minh",
  },
];
const finalReply = {
  content: "Đã chuẩn bị hành động, vui lòng xác nhận.",
  toolCalls: [],
  finishReason: "stop" as const,
  usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 },
  metadata: { provider: "ollama" as const, model: "fake", latencyMs: 1 },
};

describe("AI write actions with PostgreSQL and HTTP", () => {
  let app: INestApplication;
  let db: PrismaService;
  let tokenA: string;
  let tokenB: string;
  const provider = new FakeAIProvider("ollama");
  const client: jest.Mocked<ProductivityWriteClient> = { execute: jest.fn() };
  const auth = (token: string) => ({ Authorization: "Bearer " + token });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_INSTANCE)
      .useValue(provider)
      .overrideProvider(PRODUCTIVITY_WRITE_CLIENT)
      .useValue(client)
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
      { sub: userA, sessionId: "a", tokenType: "access" },
      options,
    );
    tokenB = await jwt.signAsync(
      { sub: userB, sessionId: "b", tokenType: "access" },
      options,
    );
  });
  async function clearSyntheticRecords() {
    const [actions, conversations] = await Promise.all([
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
        aggregateId: { in: [...actions, ...conversations].map(({ id }) => id) },
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
    client.execute.mockReset();
    provider.requests.length = 0;
  });
  afterAll(async () => {
    await clearSyntheticRecords();
    await app.close();
  });

  async function propose(write = writes[0]) {
    const requestCount = provider.requests.length;
    provider.enqueueResponse({
      ...finalReply,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [{ id: "call-1", name: write.name, arguments: write.args }],
    });
    const response = await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({
        prompt: "Please prepare the action",
        ...(write.timezone ? { timezone: write.timezone } : {}),
      })
      .expect(200);
    expect(client.execute).not.toHaveBeenCalled();
    expect(response.body.pendingActions).toHaveLength(1);
    expect(response.body.content).toContain("xác nhận");
    expect(provider.requests).toHaveLength(requestCount + 1);
    return {
      ...(response.body.pendingActions[0] as {
        actionId: string;
        payloadHash: string;
        status: string;
      }),
      conversationId: response.body.conversationId as string,
    };
  }
  const confirm = (
    action: { actionId: string; payloadHash: string },
    token = tokenA,
  ) =>
    request(app.getHttpServer())
      .post("/ai/actions/" + action.actionId + "/confirm")
      .set(auth(token))
      .send({ payloadHash: action.payloadHash });

  it.each([{ requestTimezone: undefined }, { requestTimezone: "UTC" }])(
    "returns a tool error for a write timezone mismatch ($requestTimezone)",
    async ({ requestTimezone }) => {
      const write = writes[5];
      provider.enqueueResponse({
        ...finalReply,
        content: null,
        finishReason: "tool_calls",
        toolCalls: [{ id: "call-1", name: write.name, arguments: write.args }],
      });
      provider.enqueueResponse({
        ...finalReply,
        content: "Please provide the matching timezone.",
      });

      const response = await request(app.getHttpServer())
        .post("/ai/chat")
        .set(auth(tokenA))
        .send({
          prompt: "Create a habit",
          ...(requestTimezone ? { timezone: requestTimezone } : {}),
        })
        .expect(200);

      expect(response.body.pendingActions).toEqual([]);
      expect(
        provider.requests[1]?.messages.find(
          (message) => message.role === "TOOL",
        )?.content,
      ).toBe('{"error":"AI_TOOL_CALL_INVALID"}');
      expect(await db.aIActionLog.count({ where: { userId: userA } })).toBe(0);
    },
  );

  it("stores sanitized correlated request and execution events with provider usage", async () => {
    const pending = await propose({
      name: "create_task",
      args: { title: "Private health appointment" },
    });
    const action = await db.aIActionLog.findUniqueOrThrow({
      where: { id: pending.actionId },
    });
    expect(action).toMatchObject({
      provider: "ollama",
      model: "fake",
      inputTokens: 8,
      outputTokens: 8,
    });
    client.execute.mockResolvedValue({
      id: taskId,
      title: "Private output",
      apiKey: "hidden",
    });
    const confirmed = await confirm(pending)
      .set("x-correlation-id", "trace-confirm-123")
      .expect(201);
    expect(confirmed.body.output).toEqual({ id: taskId });
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: pending.actionId },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "ai.requested",
      "ai.tool.executed",
    ]);
    const executed = events.find(
      (event) => event.eventType === "ai.tool.executed",
    );
    expect(executed?.payload).toMatchObject({
      version: 1,
      correlationId: "trace-confirm-123",
      payload: {
        actionId: pending.actionId,
        toolName: "create_task",
        status: "SUCCESS",
        provider: "ollama",
        model: "fake",
        inputTokens: 8,
        outputTokens: 8,
        resourceId: taskId,
      },
    });
    expect(JSON.stringify(events)).not.toContain("Private health appointment");
    expect(JSON.stringify(events)).not.toContain("Private output");
    expect(JSON.stringify(events)).not.toContain("hidden");
    expect(JSON.stringify(events)).not.toContain(tokenA);
  });

  it.each(writes)(
    "proposes and executes $name only after explicit confirmation",
    async (write) => {
      const pending = await propose(write);
      expect(pending.status).toBe("REQUESTED");
      const before = await db.aIActionLog.findUniqueOrThrow({
        where: { id: pending.actionId },
      });
      expect(before.status).toBe("REQUESTED");
      client.execute.mockResolvedValue({ id: taskId });
      const result = await confirm(pending).expect(201);
      expect(result.body.status).toBe("SUCCESS");
      expect(result.body.output).toEqual({ id: taskId });
      expect(client.execute).toHaveBeenCalledTimes(1);
      expect(client.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: userA, accessToken: tokenA }),
        expect.objectContaining({ name: write.name }),
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      );
      const again = await confirm(pending).expect(201);
      expect(again.body).toEqual(result.body);
      expect(client.execute).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects actions without execution", async () => {
    const pending = await propose();
    const result = await request(app.getHttpServer())
      .post("/ai/actions/" + pending.actionId + "/reject")
      .set(auth(tokenA))
      .send({ payloadHash: pending.payloadHash })
      .expect(201);
    expect(result.body.status).toBe("REJECTED");
    expect((await confirm(pending).expect(201)).body.status).toBe("REJECTED");
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("rejects expired and tampered actions before execution", async () => {
    const expired = await propose();
    await confirm({
      actionId: expired.actionId,
      payloadHash: "0".repeat(64),
    }).expect(409);
    await db.aIActionLog.update({
      where: { id: expired.actionId },
      data: { expiresAt: new Date("2000-01-01") },
    });
    await confirm(expired).expect(410);
    expect(
      (
        await db.aIActionLog.findUniqueOrThrow({
          where: { id: expired.actionId },
        })
      ).status,
    ).toBe("REJECTED");
    const tampered = await propose();
    await db.aIActionLog.update({
      where: { id: tampered.actionId },
      data: { inputPayload: { title: "changed" } },
    });
    await confirm(tampered).expect(409);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("does not reveal or execute another user's action", async () => {
    const pending = await propose();
    await confirm(pending, tokenB).expect(404);
    await request(app.getHttpServer())
      .get("/ai/actions/" + pending.actionId)
      .set(auth(tokenB))
      .expect(404);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("rejects malicious userId and timezone arguments before any pending action", async () => {
    provider.enqueueResponse({
      ...finalReply,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "bad-1",
          name: "create_task",
          arguments: { title: "Bad", userId: userB },
        },
      ],
    });
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Create a task for another user" })
      .expect(400);
    provider.enqueueResponse({
      ...finalReply,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "bad-2",
          name: "create_reminder",
          arguments: {
            resourceType: "CUSTOM",
            title: "Bad",
            remindAt: "2026-10-12T18:00:00+07:00",
            timezone: "Asia/Ho_Chi_Minh",
          },
        },
      ],
    });
    provider.enqueueResponse({
      ...finalReply,
      content: "Please check your timezone.",
    });
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({ prompt: "Set reminder", timezone: "Europe/Paris" })
      .expect(200);
    expect(
      provider.requests
        .at(-1)
        ?.messages.find((message) => message.role === "TOOL")?.content,
    ).toBe('{"error":"AI_TOOL_CALL_INVALID"}');
    expect(await db.aIActionLog.count({ where: { userId: userA } })).toBe(0);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("atomically claims a concurrent confirmation", async () => {
    const pending = await propose();
    client.execute.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { id: taskId };
    });
    const [a, b] = await Promise.all([confirm(pending), confirm(pending)]);
    expect([a.body.status, b.body.status].sort()).toEqual([
      "EXECUTING",
      "SUCCESS",
    ]);
    expect(client.execute).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.aIActionLog.findUniqueOrThrow({
          where: { id: pending.actionId },
        })
      ).status,
    ).toBe("SUCCESS");
  });

  it("records a sanitized final failure when Productivity rejects a write", async () => {
    const pending = await propose();
    client.execute.mockRejectedValue(
      new AIApplicationError(
        AIErrorCode.AI_PRODUCTIVITY_REJECTED,
        "Domain rejected",
        422,
      ),
    );
    const response = await confirm(pending).expect(201);
    expect(response.body.status).toBe("FAILED");
    expect(response.body.errorCode).toBe("AI_PRODUCTIVITY_REJECTED");
    expect(JSON.stringify(response.body)).not.toContain("Domain rejected");
    expect(
      (
        await db.aIActionLog.findUniqueOrThrow({
          where: { id: pending.actionId },
        })
      ).status,
    ).toBe("FAILED");
  });

  it("includes the persisted final action status in later chat context", async () => {
    const pending = await propose();
    client.execute.mockResolvedValue({ id: taskId });
    await confirm(pending).expect(201);
    provider.enqueueResponse(finalReply);
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set(auth(tokenA))
      .send({
        prompt: "Was the task created?",
        conversationId: pending.conversationId,
      })
      .expect(200);
    const system = provider.requests.at(-1)?.messages[0];
    expect(system?.role).toBe("SYSTEM");
    expect(system?.content).toContain(pending.actionId);
    expect(system?.content).toContain('"status":"SUCCESS"');
  });

  it("recovers expired requests and interrupted claims without replaying writes", async () => {
    const expired = await propose();
    const interrupted = await propose();
    const old = new Date("2000-01-01T00:00:00.000Z");
    await db.aIActionLog.update({
      where: { id: expired.actionId },
      data: { expiresAt: old },
    });
    await db.aIActionLog.update({
      where: { id: interrupted.actionId },
      data: { expiresAt: old, status: "EXECUTING" },
    });
    const repo = app.get<AIActionLogRepository>(AI_ACTION_LOG_REPOSITORY);
    await repo.recoverStale(new Date(), new Date(Date.now() - 60_000));
    expect(
      (
        await db.aIActionLog.findUniqueOrThrow({
          where: { id: expired.actionId },
        })
      ).status,
    ).toBe("REJECTED");
    expect(
      await db.aIActionLog.findUniqueOrThrow({
        where: { id: interrupted.actionId },
      }),
    ).toMatchObject({
      status: "FAILED",
      errorCode: "AI_ACTION_OUTCOME_UNKNOWN",
    });
    expect(client.execute).not.toHaveBeenCalled();
  });
});
