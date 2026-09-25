import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AIErrorCode } from "../src/application/errors/ai.errors";
import {
  AI_PROVIDER_CONFIG,
  type AIProviderConfig,
} from "../src/application/ports/ai-provider.port";
import { PrismaService } from "../src/prisma.service";

describe("Cloudflare AI Service boundary (e2e)", () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  let status = 200;
  let payload: unknown = {
    choices: [
      {
        message: { role: "assistant", content: "Hello from Cloudflare" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  };
  const received: { path: string; authorization?: string; body: unknown }[] =
    [];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received.push({
        path: req.url ?? "",
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString()) as unknown,
      });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
    const config: AIProviderConfig = {
      provider: "cloudflare",
      model: "@cf/test/model",
      baseUrl,
      cloudflareAccountId: "test-account",
      cloudflareApiToken: "test-provider-token",
      timeoutMs: 500,
      maxOutputTokens: 64,
      maxContextMessages: 10,
      retryMaxAttempts: 1,
      retryBaseDelayMs: 1,
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
      .overrideProvider(AI_PROVIDER_CONFIG)
      .useValue(config)
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
    token = await app
      .get(JwtService)
      .signAsync(
        { sub: "user-1", sessionId: "session-1", tokenType: "access" },
        {
          secret: process.env.JWT_ACCESS_SECRET,
          issuer: process.env.JWT_ISSUER,
          audience: process.env.JWT_AUDIENCE,
        },
      );
  });

  afterAll(async () => {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns provider-neutral output from an authenticated Cloudflare call", async () => {
    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Hi" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          content: "Hello from Cloudflare",
          metadata: { provider: "cloudflare", model: "@cf/test/model" },
        });
        expect(JSON.stringify(body)).not.toContain("test-provider-token");
      });
    expect(received.at(-1)).toMatchObject({
      path: "/client/v4/accounts/test-account/ai/v1/chat/completions",
      authorization: "Bearer test-provider-token",
      body: {
        model: "@cf/test/model",
        max_completion_tokens: 256,
        chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: "system" }, { role: "user", content: "Hi" }],
      },
    });
  });

  it("returns a controlled quota error and leaves the provider selection unchanged", async () => {
    status = 429;
    payload = { errors: [{ code: 3036, message: "upgrade to a paid plan" }] };
    const count = received.length;
    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Hi" })
      .expect(429)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: AIErrorCode.AI_PROVIDER_QUOTA_EXCEEDED,
        });
        expect(JSON.stringify(body)).not.toContain("upgrade");
        expect(JSON.stringify(body)).not.toContain("test-provider-token");
      });
    expect(received).toHaveLength(count + 1);
  });
});
