import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { once } from "node:events";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";
import { AI_PROVIDER_INSTANCE } from "../src/modules/ai/application/ports/ai-provider.port";
import { DOCUMENT_READ_CLIENT } from "../src/modules/ai/application/ports/document-read.port";
import { DocumentHttpClient } from "../src/modules/ai/infrastructure/document/document-http.client";
import { FakeAIProvider } from "../src/testing/fake-ai.provider";
const userId = randomUUID(),
  other = randomUUID();
const answer = {
  content: JSON.stringify({
    content: "Nhân viên có 12 ngày phép năm [1].",
    references: [1],
    insufficientEvidence: false,
  }),
  toolCalls: [],
  finishReason: "stop" as const,
  usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
  metadata: { provider: "ollama" as const, model: "fixture", latencyMs: 1 },
};
describe("AI → Document HTTP RAG with separate databases and real private file upload", () => {
  jest.setTimeout(60000);
  let app: INestApplication,
    db: PrismaService,
    child: ChildProcess,
    url: string,
    documentId: string,
    token: string,
    otherToken: string;
  const provider = new FakeAIProvider("ollama");
  beforeAll(async () => {
    if (
      !process.env.DOCUMENT_DATABASE_URL ||
      !process.env.DATABASE_URL ||
      process.env.DOCUMENT_DATABASE_URL === process.env.DATABASE_URL
    )
      throw new Error("Separate AI and Document test databases required");
    const directory = resolve(__dirname, "../../document-service");
    child = fork(resolve(directory, "test/ai-rag-workflow-server.ts"), [], {
      execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
      env: {
        ...process.env,
        DATABASE_URL: process.env.DOCUMENT_DATABASE_URL,
        NODE_ENV: "test",
        AI_WORKFLOW_USER_ID: userId,
        TS_NODE_PROJECT: resolve(directory, "tsconfig.json"),
        DOCUMENT_WORKER_ENABLED: "false",
        DOCUMENT_S3_PUBLIC_ENDPOINT: process.env.AWS_ENDPOINT_URL,
        EMBEDDING_PROVIDER: "fake",
        EMBEDDING_MODEL: "workflow",
        EMBEDDING_MODEL_VERSION: "fixture-v1",
        EMBEDDING_DIMENSIONS: "2",
        LOG_LEVEL: "fatal",
      },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const ready = await new Promise<{ url: string; documentId: string }>(
      (accept, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Document workflow startup timed out")),
          30000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Document workflow exited"));
        });
        child.on(
          "message",
          (m: { type: string; url: string; documentId: string }) => {
            if (m.type === "ready") {
              clearTimeout(timer);
              accept(m);
            }
            if (m.type === "error") {
              clearTimeout(timer);
              reject(new Error("Document workflow failed"));
            }
          },
        );
      },
    );
    url = ready.url;
    documentId = ready.documentId;
    const ref = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_INSTANCE)
      .useValue(provider)
      .overrideProvider(DOCUMENT_READ_CLIENT)
      .useValue(new DocumentHttpClient(url, 10000))
      .compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(PrismaService);
    const jwt = app.get(JwtService),
      opts = {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      };
    token = jwt.sign(
      { sub: userId, sessionId: "rag-workflow", tokenType: "access" },
      opts,
    );
    otherToken = jwt.sign(
      { sub: other, sessionId: "rag-other", tokenType: "access" },
      opts,
    );
  });
  afterAll(async () => {
    try {
      if (db) {
        const rows = await db.conversation.findMany({
          where: { userId: { in: [userId, other] } },
          select: { id: true },
        });
        await db.outboxEvent.deleteMany({
          where: { aggregateId: { in: rows.map((r) => r.id) } },
        });
        await db.conversation.deleteMany({
          where: { userId: { in: [userId, other] } },
        });
      }
      await app?.close();
    } finally {
      if (child?.connected) {
        const exited = once(child, "exit");
        child.send({ type: "shutdown" }, () => {});
        const timer = setTimeout(() => child.kill(), 10000);
        await exited;
        clearTimeout(timer);
      } else child?.kill();
    }
  });
  const chat = (auth: string, mode = "search") =>
    request(app.getHttpServer())
      .post("/ai/chat")
      .set("Authorization", "Bearer " + auth)
      .send({
        prompt: "Nhân viên được nghỉ phép bao nhiêu ngày một năm?",
        documentScope: { mode, documentIds: [documentId] },
      });
  it("answers from uploaded bytes with a valid persisted line citation", async () => {
    provider.enqueueResponse(answer);
    const result = await chat(token).expect(200);
    expect(result.body.content).toContain("12 ngày");
    expect(result.body.citations[0]).toMatchObject({
      documentId,
      generation: 1,
      filename: "annual-leave.txt",
      lineStart: 1,
      lineEnd: 1,
    });
    expect(
      (
        await db.message.findUniqueOrThrow({
          where: { id: result.body.assistantMessageId },
        })
      ).citations,
    ).toEqual(result.body.citations);
  });
  it("denies foreign explicit document scope before inference", async () => {
    const before = provider.requests.length;
    await chat(otherToken).expect(404);
    expect(provider.requests).toHaveLength(before);
  });
  it("summarizes authorized chunks in order through the real chunk API", async () => {
    const before = provider.requests.length;
    provider.enqueueResponse(answer);
    provider.enqueueResponse(answer);
    const result = await chat(token, "summarize").expect(200);
    expect(result.body.documentCoverage).toEqual({
      partial: false,
      chunksRead: 1,
    });
    expect(result.body.content).toContain("12 ngày");
    expect(
      provider.requests.slice(before).every((r) => r.tools === undefined),
    ).toBe(true);
  });
  it("rejects a source deleted between retrieval and answer", async () => {
    const original = provider.generate.bind(provider);
    const spy = jest
      .spyOn(provider, "generate")
      .mockImplementationOnce(async (req) => {
        await fetch(`${url}/documents/${documentId}`, {
          method: "DELETE",
          headers: { authorization: "Bearer " + token },
        });
        return original(req);
      });
    provider.enqueueResponse(answer);
    try {
      await chat(token).expect(404);
    } finally {
      spy.mockRestore();
    }
  });
});
