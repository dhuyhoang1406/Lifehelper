import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
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
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    {
      provide: AI_PROVIDER_CONFIG,
      useFactory: createAIProviderConfig,
      inject: [ConfigService],
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
