import { ConfigService } from "@nestjs/config";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
describe("HealthController", () => {
  const prisma = {
    isHealthy: jest.fn().mockResolvedValue(true),
  } as unknown as PrismaService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue("notification-service"),
  } as unknown as ConfigService;
  const controller = new HealthController(prisma, config);
  it("reports liveness", () =>
    expect(controller.live()).toMatchObject({
      status: "ok",
      service: "notification-service",
    }));
  it("reports readiness", async () =>
    expect(controller.ready()).resolves.toMatchObject({ status: "ok" }));
});
