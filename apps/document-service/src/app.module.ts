import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StructuredLoggerModule } from "@lifehelper/logger";
import { HealthController } from "./health.controller";
import { validateEnvironment } from "./env.validation";
import { PrismaModule } from "./prisma.module";
import { DocumentModule } from "./modules/document/document.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
    PrismaModule,
    DocumentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
