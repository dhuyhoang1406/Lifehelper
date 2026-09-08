import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StructuredLoggerModule } from "@lifehelper/logger";
import { HealthController } from "./health.controller";
import { validateEnvironment } from "./env.validation";
import { IdentityModule } from "./modules/identity/identity.module";
import { PrismaModule } from "./prisma.module";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
    PrismaModule,
    IdentityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
