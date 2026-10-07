import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StructuredLoggerModule } from "@lifehelper/logger";
import { HealthController } from "./health.controller";
import { validateEnvironment } from "./env.validation";
import { PrismaModule } from "./prisma.module";
import { AIModule } from "./modules/ai/ai.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
    PrismaModule,
    AIModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
