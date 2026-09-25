import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { StructuredLoggerModule } from "@lifehelper/logger";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { validateEnvironment } from "./env.validation";
import {
  AI_ACTION_LOG_REPOSITORY,
  CONVERSATION_REPOSITORY,
  MESSAGE_REPOSITORY,
} from "./application/repositories/ai.repositories";
import {
  PrismaAIActionLogRepository,
  PrismaConversationRepository,
  PrismaMessageRepository,
} from "./persistence/ai.repositories";
import {
  AI_PROVIDER_CONFIG,
  createAIProviderConfig,
} from "./config/ai-provider.config";
import {
  AI_PROVIDER_INSTANCE,
  AI_PROVIDER_ROUTER,
  type AIProvider,
  type AIProviderConfig,
} from "./application/ports/ai-provider.port";
import {
  AIProviderRegistry,
  AIProviderRouter,
} from "./application/services/ai-provider.router";
import { AIProviderRetryPolicy } from "./application/services/ai-provider-retry.policy";
import { OllamaProvider } from "./infrastructure/ai/ollama.provider";
import { CloudflareWorkersAIProvider } from "./infrastructure/ai/cloudflare-workers-ai.provider";
import {
  RandomJitterSource,
  SystemDelay,
} from "./infrastructure/ai/system-retry.adapters";
import { AIController } from "./presentation/ai.controller";
import { AIProviderExceptionFilter } from "./presentation/ai-provider-exception.filter";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
    JwtModule.register({}),
  ],
  controllers: [HealthController, AIController],
  providers: [
    PrismaService,
    JwtAuthGuard,
    { provide: APP_FILTER, useClass: AIProviderExceptionFilter },
    {
      provide: AI_PROVIDER_CONFIG,
      useFactory: createAIProviderConfig,
      inject: [ConfigService],
    },
    {
      provide: AI_PROVIDER_INSTANCE,
      useFactory: (config: AIProviderConfig): AIProvider => {
        if (config.provider === "ollama") return new OllamaProvider(config);
        if (config.provider === "cloudflare") return new CloudflareWorkersAIProvider(config);
        throw new Error(`AI provider '${config.provider}' is not implemented`);
      },
      inject: [AI_PROVIDER_CONFIG],
    },
    {
      provide: AI_PROVIDER_ROUTER,
      useFactory: (config: AIProviderConfig, provider: AIProvider) =>
        new AIProviderRouter(
          config.provider,
          new AIProviderRegistry([provider]),
          new AIProviderRetryPolicy(
            {
              maxAttempts: config.retryMaxAttempts,
              baseDelayMs: config.retryBaseDelayMs,
            },
            new SystemDelay(),
            new RandomJitterSource(),
          ),
        ),
      inject: [AI_PROVIDER_CONFIG, AI_PROVIDER_INSTANCE],
    },
    {
      provide: CONVERSATION_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaConversationRepository(db),
      inject: [PrismaService],
    },
    {
      provide: MESSAGE_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaMessageRepository(db),
      inject: [PrismaService],
    },
    {
      provide: AI_ACTION_LOG_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaAIActionLogRepository(db),
      inject: [PrismaService],
    },
  ],
})
export class AppModule {}
