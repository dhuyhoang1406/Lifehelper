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
  type ConversationRepository,
  type MessageRepository,
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
import { AIConversationController } from "./presentation/ai-conversation.controller";
import { AIConversationUseCases } from "./application/services/ai-conversation.use-cases";
import { AIProviderExceptionFilter } from "./presentation/ai-provider-exception.filter";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { PRODUCTIVITY_READ_CLIENT, type ProductivityReadClient } from "./application/ports/productivity-read.port";
import { ProductivityHttpClient } from "./infrastructure/productivity/productivity-http.client";
import { AIToolRegistry } from "./application/services/ai-tool-registry";
import { AIActionUseCases } from "./application/services/ai-action.use-cases";
import { AIActionController } from "./presentation/ai-action.controller";
import { PRODUCTIVITY_WRITE_CLIENT, type ProductivityWriteClient } from "./application/ports/productivity-write.port";
import type { AIActionLogRepository } from "./application/repositories/ai.repositories";
import { AIActionRecoveryWorker } from "./infrastructure/actions/ai-action-recovery.worker";
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
  controllers: [HealthController, AIController, AIConversationController, AIActionController],
  providers: [
    PrismaService,
    AIActionRecoveryWorker,
    JwtAuthGuard,
    {
      provide: PRODUCTIVITY_READ_CLIENT,
      useFactory: (config: ConfigService) => new ProductivityHttpClient(
        config.getOrThrow<string>("PRODUCTIVITY_SERVICE_URL"),
        config.getOrThrow<number>("PRODUCTIVITY_TIMEOUT_MS"),
      ),
      inject: [ConfigService],
    },
    { provide: PRODUCTIVITY_WRITE_CLIENT, useExisting: PRODUCTIVITY_READ_CLIENT },
    {
      provide: AIToolRegistry,
      useFactory: (client: ProductivityReadClient) => new AIToolRegistry(client),
      inject: [PRODUCTIVITY_READ_CLIENT],
    },
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
    {
      provide: AIActionUseCases,
      useFactory: (actions: AIActionLogRepository, client: ProductivityWriteClient, config: ConfigService) =>
        new AIActionUseCases(actions, client, config.getOrThrow<number>("AI_ACTION_CONFIRM_TTL_SECONDS")),
      inject: [AI_ACTION_LOG_REPOSITORY, PRODUCTIVITY_WRITE_CLIENT, ConfigService],
    },
    {
      provide: AIConversationUseCases,
      useFactory: (
        conversations: ConversationRepository,
        messages: MessageRepository,
        provider: AIProviderRouter,
        config: AIProviderConfig,
        tools: AIToolRegistry,
        actions: AIActionUseCases,
      ) =>
        new AIConversationUseCases(
          conversations,
          messages,
          provider,
          config.maxContextMessages,
          tools,
          undefined,
          undefined,
          actions,
        ),
      inject: [
        CONVERSATION_REPOSITORY,
        MESSAGE_REPOSITORY,
        AI_PROVIDER_ROUTER,
        AI_PROVIDER_CONFIG,
        AIToolRegistry,
        AIActionUseCases,
      ],
    },
  ],
})
export class AppModule {}
