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
      { sub: "user-1", sessionId: "session-1", tokenType: "access" },
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
      messages: [{ role: "USER", content: "Hi" }],
    });
  });

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
