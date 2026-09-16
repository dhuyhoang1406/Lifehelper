import type { TaskStatus as PrismaTaskStatus } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  TaskRepository,
  TaskQuery,
  CalendarEventRepository,
  HabitRepository,
  ReminderRepository,
  SubtaskRepository,
  TagRepository,
  TaskTagRepository,
} from "../application/repositories/productivity.repositories";
import type { Task } from "../modules/task/domain/entities/task.entity";
import type { CalendarEvent } from "../modules/calendar/domain/entities/calendar-event.entity";
import type { Habit } from "../modules/habit/domain/entities/habit.entity";
import type { Reminder } from "../modules/reminder/domain/entities/reminder.entity";
import type { Subtask } from "../modules/task/domain/entities/subtask.entity";
import type { Tag } from "../modules/task/domain/entities/tag.entity";
import {
  TaskMapper,
  CalendarEventMapper,
  HabitMapper,
  ReminderMapper,
  SubtaskMapper,
  TagMapper,
} from "./productivity.mappers";
export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly db: PrismaService) {}
  async findByIdAndUserId(id: string, userId: string) {
    const r = await this.db.task.findFirst({
      where: { id, userId, deletedAt: null },
    });
    return r ? TaskMapper.toDomain(r) : null;
  }
  async findPageByUserId(userId: string, q: TaskQuery) {
    const where = {
      userId,
      deletedAt: null,
      status: q.status as PrismaTaskStatus | undefined,
      priority: q.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT" | undefined,
      dueAt: q.dueAt ? { lte: q.dueAt } : undefined,
      title: q.search
        ? { contains: q.search, mode: "insensitive" as const }
        : undefined,
      taskTags: q.tag
        ? { some: { tag: { normalizedName: q.tag.trim().toLowerCase() } } }
        : undefined,
    };
    const [records, total] = await this.db.$transaction([
      this.db.task.findMany({
        where,
        orderBy: { [q.sort ?? "createdAt"]: q.direction ?? "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.task.count({ where }),
    ]);
    return {
      items: records.map(TaskMapper.toDomain),
      total,
      page: q.page,
      limit: q.limit,
    };
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
export class PrismaSubtaskRepository implements SubtaskRepository {
  constructor(private readonly db: PrismaService) {}
  async findByIdAndTaskId(id: string, taskId: string) {
    const record = await this.db.subtask.findFirst({ where: { id, taskId } });
    return record ? SubtaskMapper.toDomain(record) : null;
  }
  async findByTaskId(taskId: string) {
    return (
      await this.db.subtask.findMany({
        where: { taskId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      })
    ).map(SubtaskMapper.toDomain);
  }
  async save(entity: Subtask) {
    const data = SubtaskMapper.toPersistence(entity);
    await this.db.subtask.upsert({
      where: { id: entity.state.id },
      create: data,
      update: data,
    });
  }
  async delete(id: string) {
    await this.db.subtask.delete({ where: { id } });
  }
}
export class PrismaTagRepository implements TagRepository {
  constructor(private readonly db: PrismaService) {}
  async findByIdAndUserId(id: string, userId: string) {
    const record = await this.db.tag.findFirst({ where: { id, userId } });
    return record ? TagMapper.toDomain(record) : null;
  }
  async findByUserId(userId: string) {
    return (
      await this.db.tag.findMany({
        where: { userId },
        orderBy: { name: "asc" },
      })
    ).map(TagMapper.toDomain);
  }
  async findByNormalizedName(userId: string, normalizedName: string) {
    const record = await this.db.tag.findUnique({
      where: { userId_normalizedName: { userId, normalizedName } },
    });
    return record ? TagMapper.toDomain(record) : null;
  }
  async save(entity: Tag) {
    const data = TagMapper.toPersistence(entity);
    await this.db.tag.upsert({
      where: { id: entity.state.id },
      create: data,
      update: data,
    });
  }
  async delete(id: string) {
    await this.db.tag.delete({ where: { id } });
  }
}
export class PrismaTaskTagRepository implements TaskTagRepository {
  constructor(private readonly db: PrismaService) {}
  async attach(taskId: string, tagId: string) {
    await this.db.taskTag.upsert({
      where: { taskId_tagId: { taskId, tagId } },
      create: { taskId, tagId },
      update: {},
    });
  }
  async detach(taskId: string, tagId: string) {
    await this.db.taskTag.deleteMany({ where: { taskId, tagId } });
  }
}
export class PrismaCalendarEventRepository implements CalendarEventRepository {
  constructor(private readonly db: PrismaService) {}
  async findByIdAndUserId(id: string, userId: string) {
    const r = await this.db.calendarEvent.findFirst({
      where: { id, userId, deletedAt: null },
    });
    return r ? CalendarEventMapper.toDomain(r) : null;
  }
  async findByUserAndRange(
    userId: string,
    from?: Date,
    to?: Date,
    page = 1,
    limit = 50,
  ) {
    return (
      await this.db.calendarEvent.findMany({
        where: {
          userId,
          deletedAt: null,
          startAt: to ? { lt: to } : undefined,
          endAt: from ? { gt: from } : undefined,
        },
        orderBy: { startAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
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
