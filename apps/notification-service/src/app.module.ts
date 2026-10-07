import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StructuredLoggerModule } from "@lifehelper/logger";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma.module";
import { validateEnvironment } from "./env.validation";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
