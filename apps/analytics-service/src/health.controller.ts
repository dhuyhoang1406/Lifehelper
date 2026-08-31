import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "./prisma.service";
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  @Get("live") live() {
    return this.response();
  }
  @Get("ready") async ready() {
    if (!(await this.prisma.isHealthy()))
      throw new ServiceUnavailableException("Database is unavailable");
    return this.response();
  }
  private response() {
    return {
      status: "ok",
      service: this.config.getOrThrow<string>("SERVICE_NAME"),
      timestamp: new Date().toISOString(),
    };
  }
}
