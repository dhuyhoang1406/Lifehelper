import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AI_PROVIDER_ROUTER } from "./application/ports/ai-provider.port";
import { AIProviderRouter } from "./application/services/ai-provider.router";
import { PrismaService } from "./prisma.service";
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(AI_PROVIDER_ROUTER) private readonly provider: AIProviderRouter,
  ) {}
  @Get("live") live() {
    return this.response();
  }
  @Get("ready") async ready() {
    if (!(await this.prisma.isHealthy()))
      throw new ServiceUnavailableException("Database is unavailable");
    return this.response();
  }
  @Get("provider") async providerReady() {
    await this.provider.checkHealth();
    return {
      ...this.response(),
      provider: this.config.getOrThrow<string>("AI_PROVIDER"),
      model: this.config.getOrThrow<string>("AI_MODEL"),
    };
  }
  private response() {
    return {
      status: "ok",
      service: this.config.getOrThrow<string>("SERVICE_NAME"),
      timestamp: new Date().toISOString(),
    };
  }
}
