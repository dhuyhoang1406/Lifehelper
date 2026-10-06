import { PrismaModule } from "../../prisma.module";
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../../prisma.service";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { TaskUseCases } from "../task/application/use-cases/task.use-cases";
import { TaskController } from "../task/presentation/task.controller";
import {
  CreateCalendarEvent,
  DeleteCalendarEvent,
  GetCalendarEvent,
  ListCalendarEvents,
  UpdateCalendarEvent,
} from "../calendar/application/use-cases/calendar-event.use-cases";
import { CalendarEventController } from "../calendar/presentation/calendar-event.controller";
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
} from "../habit/application/use-cases/habit.use-cases";
import { HabitController } from "../habit/presentation/habit.controller";
import {
  CancelReminder,
  CreateReminder,
  DeleteReminder,
  GetReminder,
  ListReminders,
  UpdateReminder,
} from "../reminder/application/use-cases/reminder.use-cases";
import { ReminderController } from "../reminder/presentation/reminder.controller";
import { ProductivityExceptionFilter } from "../../presentation/productivity-exception.filter";
import {
  PrismaSubtaskRepository,
  PrismaTagRepository,
  PrismaTaskRepository,
  PrismaTaskTagRepository,
  PrismaCalendarEventRepository,
  PrismaHabitLogRepository,
  PrismaHabitRepository,
  PrismaReminderRepository,
} from "../../persistence/productivity.repositories";
import {
  SUBTASK_REPOSITORY,
  TAG_REPOSITORY,
  TASK_REPOSITORY,
  TASK_TAG_REPOSITORY,
  CALENDAR_EVENT_REPOSITORY,
  HABIT_LOG_REPOSITORY,
  HABIT_REPOSITORY,
  REMINDER_REPOSITORY,
} from "../../application/repositories/productivity.repositories";
@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [
    TaskController,
    CalendarEventController,
    HabitController,
    ReminderController,
  ],
  providers: [
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
    CreateReminder,
    GetReminder,
    ListReminders,
    UpdateReminder,
    CancelReminder,
    DeleteReminder,
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
    {
      provide: REMINDER_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaReminderRepository(db),
      inject: [PrismaService],
    },
    { provide: APP_FILTER, useClass: ProductivityExceptionFilter },
  ],
})
export class ProductivityModule {}
