import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AI_PROVIDER_INSTANCE } from "../src/application/ports/ai-provider.port";
import {
  AIProviderFailure,
  AIErrorCode,
} from "../src/application/errors/ai.errors";
import { FakeAIProvider } from "../src/testing/fake-ai.provider";
import { PrismaService } from "../src/prisma.service";

describe("AI generation (e2e)", () => {
  let app: INestApplication;
  let token: string;
  const provider = new FakeAIProvider("ollama");

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
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
    token = await app.get(JwtService).signAsync(
      {
        sub: "00000000-0000-4000-8000-000000000001",
        sessionId: "session-1",
        tokenType: "access",
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      },
    );
  });

  afterAll(async () => app.close());

  it("rejects unauthenticated and invalid prompts", async () => {
    await request(app.getHttpServer())
      .post("/ai/generate")
      .send({ prompt: "Hi" })
      .expect(401);
    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Hi", extra: true })
      .expect(400);
  });

  it("returns a provider-neutral response through AI Service", async () => {
    provider.enqueueResponse({
      content: "Hello",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      metadata: { provider: "ollama", model: "test-model", latencyMs: 4 },
    });
    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Hi" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          content: "Hello",
          metadata: { provider: "ollama" },
        });
      });
    expect(provider.requests.at(-1)).toMatchObject({
      messages: [{ role: "SYSTEM" }, { role: "USER", content: "Hi" }],
      disableReasoning: true,
    });
  });

  it("rejects a signed token with an invalid user ID before invoking the provider", async () => {
    const invalidToken = await app.get(JwtService).signAsync(
      { sub: "invalid-owner", sessionId: "session-1", tokenType: "access" },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      },
    );
    const count = provider.requests.length;
    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${invalidToken}`)
      .send({ prompt: "Hi" })
      .expect(401);
    expect(provider.requests).toHaveLength(count);
  });

  it.each([undefined, "client-request:123", "x".repeat(129)])(
    "returns a bounded correlation ID for header %s",
    async (header) => {
      provider.enqueueError(
        new AIProviderFailure("unavailable", "offline", false),
      );
      const call = request(app.getHttpServer())
        .post("/ai/generate")
        .set("Authorization", `Bearer ${token}`);
      if (header) call.set("x-correlation-id", header);
      const response = await call.send({ prompt: "Hi" }).expect(503);
      expect(response.headers["x-correlation-id"]).toMatch(
        /^[A-Za-z0-9._:-]{1,128}$/,
      );
      if (header === "client-request:123")
        expect(response.headers["x-correlation-id"]).toBe(header);
    },
  );

  it("returns stable provider error codes", async () => {
    provider.enqueueError(
      new AIProviderFailure("unavailable", "offline", false),
    );
    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Hi" })
      .expect(503)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: AIErrorCode.AI_PROVIDER_UNAVAILABLE,
        });
        expect(JSON.stringify(body)).not.toContain("Hi");
      });
  });

  it("checks selected provider health without a live Ollama", async () => {
    await request(app.getHttpServer()).get("/health/provider").expect(200);
  });
});
