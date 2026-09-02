import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StructuredLoggerModule } from "@lifehelper/logger";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { validateEnvironment } from "./env.validation";
import { IdentityModule } from "./modules/identity/identity.module";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
    IdentityModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService],
})
export class AppModule {}
