import { ConfigService } from "@nestjs/config";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { AIProviderRouter } from "./application/services/ai-provider.router";
describe("HealthController", () => {
  const prisma = {
    isHealthy: jest.fn().mockResolvedValue(true),
  } as unknown as PrismaService;
  const config = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        SERVICE_NAME: "ai-service",
        AI_PROVIDER: "ollama",
        AI_MODEL: "test-model",
      };
      return values[key];
    }),
  } as unknown as ConfigService;
  const provider = {
    checkHealth: jest.fn().mockResolvedValue(undefined),
  } as unknown as AIProviderRouter;
  const controller = new HealthController(prisma, config, provider);
  it("reports liveness", () =>
    expect(controller.live()).toMatchObject({
      status: "ok",
      service: "ai-service",
    }));
  it("reports readiness", async () =>
    expect(controller.ready()).resolves.toMatchObject({ status: "ok" }));
  it("checks provider availability separately", async () => {
    await expect(controller.providerReady()).resolves.toMatchObject({
      status: "ok",
      provider: "ollama",
      model: "test-model",
    });
    expect(provider.checkHealth).toHaveBeenCalled();
  });
});
