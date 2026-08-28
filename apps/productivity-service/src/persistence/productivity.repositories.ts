import type { TaskStatus as PrismaTaskStatus } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  TaskRepository,
  TaskQuery,
  CalendarEventRepository,
  HabitRepository,
  ReminderRepository,
} from "../application/repositories/productivity.repositories";
import type { Task } from "../modules/task/domain/entities/task.entity";
import type { CalendarEvent } from "../modules/calendar/domain/entities/calendar-event.entity";
import type { Habit } from "../modules/habit/domain/entities/habit.entity";
import type { Reminder } from "../modules/reminder/domain/entities/reminder.entity";
import {
  TaskMapper,
  CalendarEventMapper,
  HabitMapper,
  ReminderMapper,
} from "./productivity.mappers";
export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly db: PrismaService) {}
  async findById(id: string) {
    const r = await this.db.task.findUnique({ where: { id } });
    return r ? TaskMapper.toDomain(r) : null;
  }
  async findByUserId(userId: string, q: TaskQuery = {}) {
    return (
      await this.db.task.findMany({
        where: {
          userId,
          status: q.status as PrismaTaskStatus | undefined,
          dueAt: q.dueBefore ? { lte: q.dueBefore } : undefined,
          deletedAt: q.includeDeleted ? undefined : null,
        },
        orderBy: { createdAt: "desc" },
      })
    ).map(TaskMapper.toDomain);
  }
  async save(e: Task) {
    const data = TaskMapper.toPersistence(e);
    await this.db.task.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaCalendarEventRepository implements CalendarEventRepository {
  constructor(private readonly db: PrismaService) {}
  async findById(id: string) {
    const r = await this.db.calendarEvent.findUnique({ where: { id } });
    return r ? CalendarEventMapper.toDomain(r) : null;
  }
  async findByUserAndRange(userId: string, start: Date, end: Date) {
    return (
      await this.db.calendarEvent.findMany({
        where: {
          userId,
          deletedAt: null,
          startAt: { lt: end },
          endAt: { gt: start },
        },
        orderBy: { startAt: "asc" },
      })
    ).map(CalendarEventMapper.toDomain);
  }
  async save(e: CalendarEvent) {
    const data = CalendarEventMapper.toPersistence(e);
    await this.db.calendarEvent.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaHabitRepository implements HabitRepository {
  constructor(private readonly db: PrismaService) {}
  async findById(id: string) {
    const r = await this.db.habit.findUnique({ where: { id } });
    return r ? HabitMapper.toDomain(r) : null;
  }
  async findActiveByUserId(userId: string) {
    return (
      await this.db.habit.findMany({
        where: { userId, isActive: true, deletedAt: null },
        orderBy: { createdAt: "desc" },
      })
    ).map(HabitMapper.toDomain);
  }
  async save(e: Habit) {
    const data = HabitMapper.toPersistence(e);
    await this.db.habit.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaReminderRepository implements ReminderRepository {
  constructor(private readonly db: PrismaService) {}
  async findById(id: string) {
    const r = await this.db.reminder.findUnique({ where: { id } });
    return r ? ReminderMapper.toDomain(r) : null;
  }
  async findPendingBefore(at: Date) {
    return (
      await this.db.reminder.findMany({
        where: { status: "PENDING", remindAt: { lte: at } },
        orderBy: { remindAt: "asc" },
      })
    ).map(ReminderMapper.toDomain);
  }
  async save(e: Reminder) {
    const data = ReminderMapper.toPersistence(e);
    await this.db.reminder.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
