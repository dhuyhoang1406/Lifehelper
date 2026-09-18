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
  CreateCalendarEvent,
  DeleteCalendarEvent,
  GetCalendarEvent,
  ListCalendarEvents,
  UpdateCalendarEvent,
} from "./modules/calendar/application/calendar-event.use-cases";
import { CalendarEventController } from "./modules/calendar/presentation/calendar-event.controller";
import { CalendarExceptionFilter } from "./modules/calendar/presentation/calendar-exception.filter";
import {
  ArchiveHabit,
  CreateHabit,
  GetHabit,
  GetHabitLogs,
  ListHabits,
  LogHabitCompletion,
  PauseHabit,
  ResumeHabit,
  UpdateHabit,
  UpdateHabitLog,
} from "./modules/habit/application/habit.use-cases";
import { HabitController } from "./modules/habit/presentation/habit.controller";
import { HabitExceptionFilter } from "./modules/habit/presentation/habit-exception.filter";
import {
  PrismaSubtaskRepository,
  PrismaTagRepository,
  PrismaTaskRepository,
  PrismaTaskTagRepository,
  PrismaCalendarEventRepository,
  PrismaHabitLogRepository,
  PrismaHabitRepository,
} from "./persistence/productivity.repositories";
import {
  SUBTASK_REPOSITORY,
  TAG_REPOSITORY,
  TASK_REPOSITORY,
  TASK_TAG_REPOSITORY,
  CALENDAR_EVENT_REPOSITORY,
  HABIT_LOG_REPOSITORY,
  HABIT_REPOSITORY,
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
  controllers: [
    HealthController,
    TaskController,
    CalendarEventController,
    HabitController,
  ],
  providers: [
    PrismaService,
    JwtAuthGuard,
    TaskUseCases,
    CreateCalendarEvent,
    GetCalendarEvent,
    ListCalendarEvents,
    UpdateCalendarEvent,
    DeleteCalendarEvent,
    CreateHabit,
    GetHabit,
    ListHabits,
    UpdateHabit,
    PauseHabit,
    ResumeHabit,
    ArchiveHabit,
    LogHabitCompletion,
    GetHabitLogs,
    UpdateHabitLog,
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
    {
      provide: CALENDAR_EVENT_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaCalendarEventRepository(db),
      inject: [PrismaService],
    },
    {
      provide: HABIT_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaHabitRepository(db),
      inject: [PrismaService],
    },
    {
      provide: HABIT_LOG_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaHabitLogRepository(db),
      inject: [PrismaService],
    },
    { provide: APP_FILTER, useClass: TaskExceptionFilter },
    { provide: APP_FILTER, useClass: CalendarExceptionFilter },
    { provide: APP_FILTER, useClass: HabitExceptionFilter },
  ],
})
export class AppModule {}
