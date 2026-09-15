import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { StructuredLoggerModule } from "@lifehelper/logger";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { validateEnvironment } from "./env.validation";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { TaskUseCases } from "./modules/task/application/task.use-cases";
import { TaskController } from "./modules/task/presentation/task.controller";
import { TaskExceptionFilter } from "./modules/task/presentation/task-exception.filter";
import {
  PrismaSubtaskRepository,
  PrismaTagRepository,
  PrismaTaskRepository,
  PrismaTaskTagRepository,
} from "./persistence/productivity.repositories";
import {
  SUBTASK_REPOSITORY,
  TAG_REPOSITORY,
  TASK_REPOSITORY,
  TASK_TAG_REPOSITORY,
} from "./application/repositories/productivity.repositories";
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
  controllers: [HealthController, TaskController],
  providers: [
    PrismaService,
    JwtAuthGuard,
    TaskUseCases,
    {
      provide: TASK_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaTaskRepository(db),
      inject: [PrismaService],
    },
    {
      provide: SUBTASK_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaSubtaskRepository(db),
      inject: [PrismaService],
    },
    {
      provide: TAG_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaTagRepository(db),
      inject: [PrismaService],
    },
    {
      provide: TASK_TAG_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaTaskTagRepository(db),
      inject: [PrismaService],
    },
    { provide: APP_FILTER, useClass: TaskExceptionFilter },
  ],
})
export class AppModule {}
