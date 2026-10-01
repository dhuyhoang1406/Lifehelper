import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AI_PROVIDER_INSTANCE } from "../src/application/ports/ai-provider.port";
import { PRODUCTIVITY_READ_CLIENT } from "../src/application/ports/productivity-read.port";
import { ProductivityHttpClient } from "../src/infrastructure/productivity/productivity-http.client";
import { FakeAIProvider } from "../src/testing/fake-ai.provider";
import { PrismaService } from "../src/prisma.service";

const userId = randomUUID();
const otherUserId = randomUUID();
const provider = new FakeAIProvider("ollama");
const answer = {
  content: "Done",
  toolCalls: [],
  finishReason: "stop" as const,
  usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  metadata: { provider: "ollama" as const, model: "test-model", latencyMs: 1 },
};

describe("AI → Productivity HTTP workflow with separate PostgreSQL databases", () => {
  jest.setTimeout(30_000);
  let app: INestApplication;
  let child: ChildProcess;
  let url: string;
  let token: string;
  let otherToken: string;
  let db: PrismaService;
  const traces: Array<{
    method: string;
    path: string;
    correlationId?: string;
  }> = [];

  beforeAll(async () => {
    if (!process.env.PRODUCTIVITY_DATABASE_URL || !process.env.DATABASE_URL)
      throw new Error(
        "Set DATABASE_URL and PRODUCTIVITY_DATABASE_URL to migrated test databases",
      );
    if (process.env.DATABASE_URL === process.env.PRODUCTIVITY_DATABASE_URL)
      throw new Error("AI and Productivity must own separate test databases");
    const directory = resolve(__dirname, "../../productivity-service");
    child = fork(resolve(directory, "test/ai-workflow-server.ts"), [], {
      execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
      env: {
        ...process.env,
        DATABASE_URL: process.env.PRODUCTIVITY_DATABASE_URL,
        SERVICE_NAME: "productivity-service",
        AI_WORKFLOW_USER_ID: userId,
        TS_NODE_PROJECT: resolve(directory, "tsconfig.json"),
        LOG_LEVEL: "fatal",
      },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    url = await new Promise<string>((accept, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Productivity startup timed out")),
        15_000,
      );
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Productivity exited before readiness"));
      });
      child.on(
        "message",
        (message: {
          type: string;
          url?: string;
          method: string;
          path: string;
          correlationId?: string;
        }) => {
          if (message.type === "trace") traces.push(message);
          if (message.type === "ready" && message.url) {
            clearTimeout(timer);
            accept(message.url);
          }
          if (message.type === "error") {
            clearTimeout(timer);
            reject(new Error("Productivity startup failed"));
          }
        },
      );
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_INSTANCE)
      .useValue(provider)
      .overrideProvider(PRODUCTIVITY_READ_CLIENT)
      .useValue(new ProductivityHttpClient(url, 3000))
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
    const options = {
      secret: process.env.JWT_ACCESS_SECRET,
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    };
    token = await app
      .get(JwtService)
      .signAsync(
        { sub: userId, sessionId: "workflow", tokenType: "access" },
        options,
      );
    otherToken = await app
      .get(JwtService)
      .signAsync(
        { sub: otherUserId, sessionId: "workflow-other", tokenType: "access" },
        options,
      );
  });

  afterAll(async () => {
    if (db) {
      const [actions, conversations] = await Promise.all([
        db.aIActionLog.findMany({ where: { userId }, select: { id: true } }),
        db.conversation.findMany({ where: { userId }, select: { id: true } }),
      ]);
      await db.outboxEvent.deleteMany({
        where: {
          aggregateId: {
            in: [...actions, ...conversations].map((row) => row.id),
          },
        },
      });
      await db.aIActionLog.deleteMany({ where: { userId } });
      await db.conversation.deleteMany({ where: { userId } });
    }
    await app?.close();
    if (child?.connected) {
      await new Promise<void>((accept) => {
        const timer = setTimeout(() => {
          child.kill();
          accept();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          accept();
        });
        child.send({ type: "shutdown" });
      });
    }
  });

  async function propose(
    name: string,
    args: Record<string, string>,
    timezone?: string,
  ) {
    provider.enqueueResponse({
      ...answer,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [{ id: randomUUID(), name, arguments: args }],
    });
    const response = await request(app.getHttpServer())
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Prepare action", timezone })
      .expect(200);
    return response.body.pendingActions[0] as {
      actionId: string;
      payloadHash: string;
    };
  }

  it("creates exactly one task under concurrent confirmation, forwards correlation, and enforces ownership", async () => {
    const action = await propose("create_task", { title: "Workflow task" });
    const confirm = () =>
      request(app.getHttpServer())
        .post(`/ai/actions/${action.actionId}/confirm`)
        .set("Authorization", `Bearer ${token}`)
        .send({ payloadHash: action.payloadHash });
    const confirmations = await Promise.all([confirm(), confirm()]);
    expect(confirmations.every((response) => response.status === 201)).toBe(
      true,
    );
    const final = await confirm().expect(201);
    expect(final.body.status).toBe("SUCCESS");
    const tasks = await request(url)
      .get("/tasks")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(tasks.body.total).toBe(1);
    const writes = traces.filter(
      (trace) => trace.method === "POST" && trace.path === "/tasks",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].correlationId).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: action.actionId },
    });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.occurredAt instanceof Date)).toBe(
      true,
    );
    const executed = events.find(
      (event) => event.eventType === "ai.tool.executed",
    );
    expect(executed?.payload).toMatchObject({
      correlationId: writes[0].correlationId,
    });
    expect(
      confirmations.map((response) => response.headers["x-correlation-id"]),
    ).toContain(writes[0].correlationId);
    await request(app.getHttpServer())
      .get(`/ai/actions/${action.actionId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(404);
    const otherTasks = await request(url)
      .get("/tasks")
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(200);
    expect(otherTasks.body.total).toBe(0);
  });

  it("persists chat continuation and runs today's task tool over HTTP", async () => {
    provider.enqueueResponse(answer);
    const first = await request(app.getHttpServer())
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Hello workflow" })
      .expect(200);
    provider.enqueueResponse({
      ...answer,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "today",
          name: "get_today_tasks",
          arguments: { timezone: "Asia/Ho_Chi_Minh" },
        },
      ],
    });
    provider.enqueueResponse(answer);
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({
        prompt: "Today's tasks",
        timezone: "Asia/Ho_Chi_Minh",
        conversationId: first.body.conversationId,
      })
      .expect(200);
    const sent = provider.requests.at(-1)!;
    expect(
      sent.messages.some((message) => message.content === "Hello workflow"),
    ).toBe(true);
    expect(
      sent.messages.some(
        (message) => message.role === "TOOL" && message.toolCallId === "today",
      ),
    ).toBe(true);
    expect(
      traces.some((trace) => trace.method === "GET" && trace.path === "/tasks"),
    ).toBe(true);
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ prompt: "Continue", conversationId: first.body.conversationId })
      .expect(404);
  });

  it("rejects an unregistered destructive tool before any downstream request", async () => {
    const requestCount = traces.length;
    provider.enqueueResponse({
      ...answer,
      content: null,
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "unknown",
          name: "delete_task",
          arguments: { taskId: randomUUID() },
        },
      ],
    });
    await request(app.getHttpServer())
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Delete task" })
      .expect(400);
    expect(traces).toHaveLength(requestCount);
  });

  it("stores calendar instants with their explicit timezone", async () => {
    const action = await propose(
      "create_calendar_event",
      {
        title: "Timezone workflow",
        eventType: "MEETING",
        timezone: "Asia/Ho_Chi_Minh",
        startAt: "2026-10-12T00:30:00+07:00",
        endAt: "2026-10-12T01:30:00+07:00",
      },
      "Asia/Ho_Chi_Minh",
    );
    await request(app.getHttpServer())
      .post(`/ai/actions/${action.actionId}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({ payloadHash: action.payloadHash })
      .expect(201);
    const events = await request(url)
      .get("/calendar-events")
      .query({ from: "2026-10-11T00:00:00Z", to: "2026-10-13T00:00:00Z" })
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(events.body[0]).toMatchObject({
      timezone: "Asia/Ho_Chi_Minh",
      startAt: "2026-10-11T17:30:00.000Z",
    });
  });
});
